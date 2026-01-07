import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireActiveSubscription } from '../../../../lib/requireActiveSubscription';
import { appendInvoiceNote } from '../../../../lib/smartInvoice';
import { deleteInvoiceLinkedTransactions, upsertRevenueTransactionForInvoice } from '../../../../lib/invoiceTransactionSync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function isIso(iso: any) {
  const s = String(iso ?? '');
  const d = new Date(s);
  return s && !Number.isNaN(d.getTime());
}

function isUuid(v: any): boolean {
  const s = String(v ?? '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function parsePositiveInt(v: any): number | null {
  const s = String(v ?? '').trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function addMinutesIso(startIso: string, mins: number) {
  const d = new Date(startIso);
  return new Date(d.getTime() + mins * 60 * 1000).toISOString();
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireActiveSubscription(request);
  if (!(gate as any)?.ok) return gate as any;

  const token = getBearerToken(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const idRaw = String(id ?? '').trim();
  if (!idRaw) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const bookingIdForEq: string | number | null = isUuid(idRaw) ? idRaw : parsePositiveInt(idRaw);
  if (!bookingIdForEq) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body: any = await request.json().catch(() => null);
  const businessId = String(body?.businessId ?? '');
  const status = body?.status ? String(body.status) : null;
  const startAt = body?.startAt ? String(body.startAt) : null;
  const paymentAmount = body?.paymentAmount === null || body?.paymentAmount === undefined ? null : Number(body.paymentAmount);
  const markPaid = Boolean(body?.markPaid);
  const paid: boolean | null = typeof body?.paid === 'boolean' ? Boolean(body.paid) : null;

  if (!businessId) return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
  if (startAt && !isIso(startAt)) return NextResponse.json({ error: 'startAt must be ISO' }, { status: 400 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnon) {
    return NextResponse.json(
      { error: 'Server is missing Supabase env vars (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).' },
      { status: 500 }
    );
  }

  const supabase = createClient(
    supabaseUrl,
    supabaseAnon,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } }
  );

  // Load booking + service duration
  const { data: booking, error: bErr } = await supabase
    .from('bookings')
    .select('id,business_id,service_id,start_at,end_at,status,invoice_id,services(duration_minutes)')
    .eq('business_id', businessId)
    .eq('id', bookingIdForEq as any)
    .single();
  if (bErr || !booking) return NextResponse.json({ error: bErr?.message ?? 'Not found' }, { status: 404 });

  const patch: any = {};
  if (status) patch.status = status;

  let nextStart = startAt;
  let nextEnd: string | null = null;
  if (startAt) {
    const dur = Number((booking as any)?.services?.duration_minutes) || 60;
    nextEnd = addMinutesIso(startAt, dur);

    // conflict check
    const { data: conflicts } = await supabase
      .from('bookings')
      .select('id')
      .eq('business_id', businessId)
      .neq('id', bookingIdForEq as any)
      .neq('status', 'cancelled')
      .lt('start_at', nextEnd)
      .gt('end_at', startAt)
      .limit(1);
    if ((conflicts ?? []).length > 0) {
      return NextResponse.json({ error: 'That time is no longer available.' }, { status: 409 });
    }

    patch.start_at = startAt;
    patch.end_at = nextEnd;
  }

  const { data: updated, error: uErr } = await supabase
    .from('bookings')
    .update(patch)
    .eq('business_id', businessId)
    .eq('id', bookingIdForEq as any)
    .select('*')
    .single();
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 400 });

  // Sync calendar event
  if (status === 'cancelled') {
    await supabase
      .from('calendar_events')
      .delete()
      .eq('business_id', businessId)
      .eq('booking_id', bookingIdForEq as any);
  } else {
    const calPatch: any = {};
    if (nextStart && nextEnd) {
      calPatch.start_at = nextStart;
      calPatch.end_at = nextEnd;
    }
    if (Object.keys(calPatch).length) {
      await supabase
        .from('calendar_events')
        .update(calPatch)
        .eq('business_id', businessId)
        .eq('booking_id', bookingIdForEq as any);
    }
  }

  // Sync invoice (1 booking = 1 invoice)
  const invoiceId = Number((booking as any)?.invoice_id ?? 0) || null;
  if (invoiceId) {
    // cancel -> void the invoice
    if (status === 'cancelled') {
      await supabase
        .from('invoices')
        .update({ status: 'void' } as any)
        .eq('business_id', businessId)
        .eq('id', invoiceId);
      try {
        await deleteInvoiceLinkedTransactions({ supabase, businessId, invoiceId });
      } catch {
        // ignore
      }
      try {
        await appendInvoiceNote({
          supabase,
          businessId,
          invoiceId,
          line: `Booking cancelled at ${new Date().toISOString()}`,
        });
      } catch {
        // ignore
      }
    }

    // reschedule -> update invoice notes/metadata (no new invoice)
    if (startAt && nextEnd) {
      try {
        await appendInvoiceNote({
          supabase,
          businessId,
          invoiceId,
          line: `Booking rescheduled to ${startAt} → ${nextEnd}`,
        });
      } catch {
        // ignore
      }
    }

    // payment/deposit -> update invoice status (schema-safe: amount_paid may not exist yet)
    if (paid === false) {
      // Force unpaid: move invoice back to "sent" and remove linked revenue transaction.
      await supabase
        .from('invoices')
        .update({ status: 'sent' } as any)
        .eq('business_id', businessId)
        .eq('id', invoiceId);
      try {
        await deleteInvoiceLinkedTransactions({ supabase, businessId, invoiceId });
      } catch {
        // ignore
      }
      try {
        await appendInvoiceNote({
          supabase,
          businessId,
          invoiceId,
          line: `Payment status toggled: unpaid at ${new Date().toISOString()}`,
        });
      } catch {
        // ignore
      }
    } else if (paid === true) {
      // Force paid.
      const { data: paidInvoice, error: updErr } = await supabase
        .from('invoices')
        .update({ status: 'paid' } as any)
        .eq('business_id', businessId)
        .eq('id', invoiceId)
        .select('*')
        .maybeSingle();
      if (!updErr && paidInvoice) {
        try {
          await upsertRevenueTransactionForInvoice({ supabase, businessId, invoice: paidInvoice });
        } catch {
          // eslint-disable-next-line no-console
          console.error('INVOICE_TX_UPSERT_ERROR', { invoiceId, businessId });
        }
      }
      try {
        await appendInvoiceNote({
          supabase,
          businessId,
          invoiceId,
          line: `Payment status toggled: paid at ${new Date().toISOString()}`,
        });
      } catch {
        // ignore
      }
    } else if (markPaid || (paymentAmount !== null && Number.isFinite(paymentAmount) && paymentAmount > 0)) {
      // Always append a note; then try updating amount_paid if column exists, otherwise fall back to status-only.
      const add = markPaid ? null : Number(paymentAmount) || 0;
      try {
        await appendInvoiceNote({
          supabase,
          businessId,
          invoiceId,
          line: markPaid ? 'Payment recorded: marked paid.' : `Payment recorded: $${Number(add || 0).toFixed(2)}`,
        });
      } catch {
        // ignore
      }

      if (markPaid) {
        // If schema supports it, mark paid.
        // eslint-disable-next-line no-console
        console.log('BOOKING_PAYMENT_MARK_PAID', { invoiceId });
        const { data: paidInvoice, error: updErr } = await supabase
          .from('invoices')
          .update({ status: 'paid' } as any)
          .eq('business_id', businessId)
          .eq('id', invoiceId)
          .select('*')
          .maybeSingle();
        if (updErr) {
          // Non-fatal; booking update should still succeed.
        } else if (paidInvoice) {
          try {
            await upsertRevenueTransactionForInvoice({ supabase, businessId, invoice: paidInvoice });
          } catch {
            // eslint-disable-next-line no-console
            console.error('INVOICE_TX_UPSERT_ERROR', { invoiceId, businessId });
          }
        }
      } else {
        // Attempt to update amount_paid if the column exists; ignore schema errors.
        try {
          const { data: inv, error: selErr } = await supabase
            .from('invoices')
            .select('id,total,amount_paid,status')
            .eq('business_id', businessId)
            .eq('id', invoiceId)
            .maybeSingle();
          if (!selErr && inv) {
            const prevPaid = Number((inv as any).amount_paid) || 0;
            const nextPaid = Math.max(0, prevPaid + Number(add || 0));
            await supabase
              .from('invoices')
              .update({ amount_paid: nextPaid } as any)
              .eq('business_id', businessId)
              .eq('id', invoiceId);
            // Even if amount_paid doesn't exist, status may still be updated elsewhere; keep tx best-effort.
            try {
              await upsertRevenueTransactionForInvoice({ supabase, businessId, invoice: inv });
            } catch {
              // eslint-disable-next-line no-console
              console.error('INVOICE_TX_UPSERT_ERROR', { invoiceId, businessId });
            }
          }
        } catch {
          // ignore
        }
      }
    }
  }

  return NextResponse.json({ booking: updated });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireActiveSubscription(request);
  if (!(gate as any)?.ok) return gate as any;

  const token = getBearerToken(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const idRaw = String(id ?? '').trim();
  if (!idRaw) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const bookingIdForEq: string | number | null = isUuid(idRaw) ? idRaw : parsePositiveInt(idRaw);
  if (!bookingIdForEq) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body: any = await request.json().catch(() => null);
  const businessId = String(body?.businessId ?? '');
  if (!businessId) return NextResponse.json({ error: 'businessId is required' }, { status: 400 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnon) {
    return NextResponse.json(
      { error: 'Server is missing Supabase env vars (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).' },
      { status: 500 }
    );
  }

  const supabase = createClient(
    supabaseUrl,
    supabaseAnon,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } }
  );

  // Load booking so we can sync invoice before deleting.
  const { data: booking, error: bErr } = await supabase
    .from('bookings')
    .select('id,business_id,invoice_id')
    .eq('business_id', businessId)
    .eq('id', bookingIdForEq as any)
    .maybeSingle();
  if (bErr) return NextResponse.json({ error: bErr.message ?? 'Not found' }, { status: 404 });

  const invoiceId = Number((booking as any)?.invoice_id ?? 0) || null;
  if (invoiceId) {
    // Void the invoice and remove any linked revenue transaction (best-effort).
    await supabase
      .from('invoices')
      .update({ status: 'void' } as any)
      .eq('business_id', businessId)
      .eq('id', invoiceId);
    try {
      await deleteInvoiceLinkedTransactions({ supabase, businessId, invoiceId });
    } catch {
      // ignore
    }
    try {
      await appendInvoiceNote({
        supabase,
        businessId,
        invoiceId,
        line: `Booking cancelled (deleted) at ${new Date().toISOString()}`,
      });
    } catch {
      // ignore
    }
  }

  // Delete booking row. calendar_events should cascade in most schemas, but also delete best-effort.
  const { error: delErr } = await supabase
    .from('bookings')
    .delete()
    .eq('business_id', businessId)
    .eq('id', bookingIdForEq as any);
  if (delErr) return NextResponse.json({ error: delErr.message ?? 'Delete failed' }, { status: 400 });

  try {
    await supabase
      .from('calendar_events')
      .delete()
      .eq('business_id', businessId)
      .eq('booking_id', bookingIdForEq as any);
  } catch {
    // ignore
  }

  return NextResponse.json({ ok: true });
}


