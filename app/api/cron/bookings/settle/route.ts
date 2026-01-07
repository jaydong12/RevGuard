import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { generateInvoiceNumber } from '../../../../../lib/invoiceNumber';
import { upsertRevenueTransactionForInvoice } from '../../../../../lib/invoiceTransactionSync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requireCronSecret(req: Request) {
  const expected = process.env.CRON_SECRET || process.env.CRON_API_KEY || null;
  if (!expected) return { ok: false, error: 'Missing CRON_SECRET env' as const };
  const got =
    req.headers.get('x-cron-secret') ||
    req.headers.get('x-cron-key') ||
    req.headers.get('authorization') ||
    '';
  const token = String(got).replace(/^Bearer\s+/i, '').trim();
  if (token !== expected) return { ok: false, error: 'Unauthorized' as const };
  return { ok: true } as const;
}

function toIsoNow() {
  return new Date().toISOString();
}

export async function POST(request: Request) {
  const auth = requireCronSecret(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.error === 'Unauthorized' ? 401 : 500 });

  const supabaseAdmin = getSupabaseAdmin();
  const nowIso = toIsoNow();

  // Pull ended bookings that are still pending/confirmed (not yet settled).
  const { data: bookings, error: bErr } = await supabaseAdmin
    .from('bookings')
    .select('id,business_id,service_id,customer_name,start_at,end_at,status,invoice_id,price_cents')
    .lt('end_at', nowIso)
    .in('status', ['pending', 'confirmed'] as any)
    .order('end_at', { ascending: true })
    .limit(200);

  if (bErr) {
    return NextResponse.json({ error: bErr.message ?? String(bErr) }, { status: 500 });
  }

  const rows = (bookings ?? []) as any[];
  let processed = 0;
  let createdInvoices = 0;
  let upsertedTransactions = 0;
  const errors: any[] = [];

  for (const b of rows) {
    try {
      const bookingIdRaw = (b as any)?.id;
      const bookingIdStr = String(bookingIdRaw ?? '').trim();
      const businessId = String((b as any)?.business_id ?? '').trim();
      if (!bookingIdStr || !businessId) continue;

      // Resolve service name (best-effort).
      let serviceName = 'Service';
      try {
        const { data: svc } = await supabaseAdmin
          .from('services')
          .select('id,name')
          .eq('business_id', businessId)
          // tolerate uuid/bigint mismatch across DBs
          .filter('id', 'eq', String((b as any)?.service_id ?? ''))
          .maybeSingle();
        if (svc?.name) serviceName = String((svc as any).name);
      } catch {
        // ignore
      }

      // Ensure invoice exists (idempotent).
      let invoiceId = Number((b as any)?.invoice_id ?? 0) || null;
      let invoiceRow: any | null = null;

      if (invoiceId) {
        const { data: inv } = await supabaseAdmin
          .from('invoices')
          .select('*')
          .eq('business_id', businessId)
          .eq('id', invoiceId)
          .maybeSingle();
        invoiceRow = (inv as any) ?? null;
      }

      if (!invoiceRow) {
        // Try finding invoice by booking_id if that column exists in this DB.
        try {
          const { data: invByBooking, error: invBkErr } = await supabaseAdmin
            .from('invoices')
            .select('*')
            .eq('business_id', businessId)
            .eq('booking_id', bookingIdRaw as any)
            .maybeSingle();
          if (!invBkErr && invByBooking) {
            invoiceRow = invByBooking as any;
            invoiceId = Number((invoiceRow as any)?.id ?? 0) || null;
          }
        } catch {
          // ignore
        }
      }

      if (!invoiceRow) {
        const cents = Math.max(0, Number((b as any)?.price_cents ?? 0) || 0);
        const total = cents / 100;
        const issueDate = new Date().toISOString().slice(0, 10);
        const invNum = await generateInvoiceNumber({ supabase: supabaseAdmin, businessId });

        const payloadBase: any = {
          business_id: businessId,
          invoice_number: invNum,
          client_name: String((b as any)?.customer_name ?? 'Customer') || 'Customer',
          issue_date: issueDate,
          due_date: issueDate,
          status: 'paid',
          subtotal: total,
          tax: 0,
          total,
          notes: `Auto-settled from booking ${bookingIdStr}`,
        };

        // Try inserting with booking linkage fields if present in this DB; fall back if not.
        let inserted: any | null = null;
        {
          const attempt1: any = { ...payloadBase, source: 'booking', booking_id: bookingIdRaw };
          const { data: inv1, error: e1 } = await supabaseAdmin
            .from('invoices')
            .insert(attempt1)
            .select('*')
            .single();
          if (!e1 && inv1) {
            inserted = inv1 as any;
          } else {
            const { data: inv2, error: e2 } = await supabaseAdmin
              .from('invoices')
              .insert(payloadBase)
              .select('*')
              .single();
            if (e2) throw e2;
            inserted = inv2 as any;
          }
        }

        invoiceRow = inserted;
        invoiceId = Number((inserted as any)?.id ?? 0) || null;
        createdInvoices += 1;

        // Best-effort: create one line item if table exists.
        try {
          if (invoiceId) {
            await supabaseAdmin.from('invoice_items').insert({
              invoice_id: invoiceId,
              description: serviceName,
              quantity: 1,
              unit_price: total,
            } as any);
          }
        } catch {
          // ignore
        }

        // Link booking to invoice if the booking has invoice_id column.
        if (invoiceId) {
          try {
            await supabaseAdmin
              .from('bookings')
              .update({ invoice_id: invoiceId } as any)
              .eq('business_id', businessId)
              .eq('id', bookingIdRaw as any);
          } catch {
            // ignore
          }
        }
      }

      // Mark booking as paid (fall back to completed if status constraint doesn't allow it).
      try {
        await supabaseAdmin
          .from('bookings')
          .update({ status: 'paid' } as any)
          .eq('business_id', businessId)
          .eq('id', bookingIdRaw as any);
      } catch {
        await supabaseAdmin
          .from('bookings')
          .update({ status: 'completed' } as any)
          .eq('business_id', businessId)
          .eq('id', bookingIdRaw as any);
      }

      // Upsert transaction (income) linked by invoice_id/business_id; description = service name.
      if (invoiceRow) {
        await upsertRevenueTransactionForInvoice({
          supabase: supabaseAdmin,
          businessId,
          invoice: invoiceRow,
          descriptionOverride: serviceName,
          sourceOverride: 'booking',
          bookingIdOverride: bookingIdStr,
        });
        upsertedTransactions += 1;
      }

      processed += 1;
    } catch (e: any) {
      errors.push({ booking_id: String((b as any)?.id ?? ''), error: String(e?.message ?? e) });
    }
  }

  return NextResponse.json({
    ok: true,
    nowIso,
    found: rows.length,
    processed,
    createdInvoices,
    upsertedTransactions,
    errors,
  });
}

// Convenience for schedulers that only support GET.
export async function GET(request: Request) {
  return POST(request);
}


