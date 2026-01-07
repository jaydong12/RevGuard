import type { SupabaseClient } from '@supabase/supabase-js';

function isMissingColumnError(e: any) {
  // Postgres undefined_column
  return String(e?.code ?? '') === '42703' || /column .* does not exist/i.test(String(e?.message ?? ''));
}

async function getInvoiceTransactionId(params: {
  supabase: SupabaseClient;
  businessId: string;
  invoiceId: number;
}): Promise<number | null> {
  const { supabase, businessId, invoiceId } = params;
  try {
    const { data, error } = await supabase
      .from('invoices')
      .select('id,transaction_id')
      .eq('business_id', businessId)
      .eq('id', invoiceId)
      .maybeSingle();
    if (error) return null;
    const tid = Number((data as any)?.transaction_id ?? 0) || null;
    return tid;
  } catch {
    return null;
  }
}

async function setInvoiceTransactionId(params: {
  supabase: SupabaseClient;
  businessId: string;
  invoiceId: number;
  transactionId: number | null;
}) {
  const { supabase, businessId, invoiceId, transactionId } = params;
  try {
    await supabase
      .from('invoices')
      .update({ transaction_id: transactionId } as any)
      .eq('business_id', businessId)
      .eq('id', invoiceId);
  } catch {
    // ignore
  }
}

export async function upsertRevenueTransactionForInvoice(params: {
  supabase: SupabaseClient;
  businessId: string;
  invoice: any;
  descriptionOverride?: string | null;
  sourceOverride?: string | null;
  bookingIdOverride?: string | number | null;
}) {
  const { supabase, businessId, invoice, descriptionOverride, sourceOverride, bookingIdOverride } = params;
  const invoiceId = Number(invoice?.id ?? 0) || null;
  if (!invoiceId) return;

  const date = String(invoice?.issue_date ?? '').trim() || new Date().toISOString().slice(0, 10);
  const customer_name = String(invoice?.client_name ?? '').trim() || 'Unknown Customer (Needs Review)';
  const invoice_number = String(invoice?.invoice_number ?? '').trim() || `INV-${invoiceId}`;

  // Money standard: prefer *_cents integers everywhere.
  // For booking-linked invoices, the authoritative amount is bookings.price_cents.
  let amount_cents: number | null = null;
  let service_name: string | null = null;
  try {
    const { data: booking } = await supabase
      .from('bookings')
      .select('id,price_cents,service_id')
      .eq('business_id', businessId)
      .eq('invoice_id', invoiceId)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (booking) {
      const cents = Number((booking as any)?.price_cents);
      if (Number.isFinite(cents)) amount_cents = Math.trunc(cents);

      const sid = (booking as any)?.service_id ?? null;
      if (sid != null) {
        const { data: svc } = await supabase
          .from('services')
          .select('name')
          .eq('business_id', businessId)
          // tolerate bigint/uuid mismatch across DBs
          .filter('id', 'eq', String(sid))
          .maybeSingle();
        if (svc && (svc as any)?.name) service_name = String((svc as any).name);
      }
    }
  } catch {
    // ignore; fall back to invoice totals below
  }

  // Fallback if we couldn't resolve booking snapshot cents (legacy invoices).
  if (amount_cents === null) {
    const amount = Number(invoice?.total ?? invoice?.subtotal ?? 0) || 0;
    amount_cents = Math.round(amount * 100);
  }

  const amount = Math.abs(Number(amount_cents || 0)) / 100;
  const description =
    String(descriptionOverride ?? '').trim() ||
    String(service_name ?? '').trim() ||
    `Invoice ${invoice_number}`;
  const booking_id =
    bookingIdOverride !== undefined && bookingIdOverride !== null
      ? String(bookingIdOverride)
      : invoice?.booking_id != null
        ? String(invoice.booking_id)
        : null;
  const source = String(sourceOverride ?? invoice?.source ?? '').trim() || null;

  try {
    // Preferred: use transactions.invoice_id linkage (unique per invoice).
    // Also clean up any historical duplicates (keep the lowest id).
    const { data: rows, error: selErr } = await supabase
      .from('transactions')
      .select('id')
      .eq('business_id', businessId)
      .eq('invoice_id', invoiceId)
      .order('id', { ascending: true });

    if (!selErr) {
      const ids = ((rows ?? []) as any[]).map((r) => Number((r as any)?.id ?? 0)).filter((n) => Number.isFinite(n) && n > 0);
      const keepId = ids[0] ?? null;

      // Delete duplicates if any.
      if (ids.length > 1) {
        const extras = ids.slice(1);
        await supabase
          .from('transactions')
          .delete()
          .eq('business_id', businessId)
          .in('id', extras as any);
      }

      if (keepId) {
        // Schema-safe update: retry with fewer fields if some columns don't exist yet.
        const updateAttempts: any[] = [
          {
            date,
            amount_cents: Math.abs(Number(amount_cents || 0)),
            amount,
            type: 'income',
            category: 'Services',
            description,
            customer_name,
            source,
            booking_id,
            invoice_id: invoiceId,
          },
          { date, amount_cents: Math.abs(Number(amount_cents || 0)), amount, category: 'Services', description, customer_name, booking_id, invoice_id: invoiceId },
          { date, amount_cents: Math.abs(Number(amount_cents || 0)), amount, category: 'Services', description, booking_id, invoice_id: invoiceId },
          { date, amount, category: 'Services', description, booking_id, invoice_id: invoiceId },
          { date, amount, description },
        ];
        let lastErr: any = null;
        for (const patch of updateAttempts) {
          const { error: updErr } = await supabase
            .from('transactions')
            .update(patch as any)
            .eq('business_id', businessId)
            .eq('id', keepId);
          if (!updErr) {
            lastErr = null;
            break;
          }
          lastErr = updErr;
          if (!isMissingColumnError(updErr)) break;
        }
        if (lastErr) throw lastErr;

        // Keep invoices.transaction_id synced too (best-effort).
        await setInvoiceTransactionId({ supabase, businessId, invoiceId, transactionId: keepId });
        return;
      }

      // No existing row: insert.
      const insertAttempts: any[] = [
        {
          business_id: businessId,
          invoice_id: invoiceId,
          source,
          booking_id,
          date,
          amount_cents: Math.abs(Number(amount_cents || 0)),
          amount,
          type: 'income',
          category: 'Services',
          description,
          customer_name,
          customer_id: null,
        },
        {
          business_id: businessId,
          invoice_id: invoiceId,
          booking_id,
          date,
          amount_cents: Math.abs(Number(amount_cents || 0)),
          amount,
          category: 'Services',
          description,
          customer_name,
          customer_id: null,
        },
        {
          business_id: businessId,
          invoice_id: invoiceId,
          booking_id,
          date,
          amount_cents: Math.abs(Number(amount_cents || 0)),
          amount,
          category: 'Services',
          description,
          customer_id: null,
        },
        {
          business_id: businessId,
          invoice_id: invoiceId,
          booking_id,
          date,
          amount,
          description,
        },
        {
          business_id: businessId,
          booking_id,
          date,
          amount,
          description,
        },
      ];
      let insertedId: number | null = null;
      let lastErr: any = null;
      for (const payload of insertAttempts) {
        const { data: inserted, error: insErr } = await supabase
          .from('transactions')
          .insert(payload as any)
          .select('id')
          .single();
        if (!insErr) {
          insertedId = Number((inserted as any)?.id ?? 0) || null;
          lastErr = null;
          break;
        }
        // If unique constraint exists and we raced, ignore (another client inserted).
        if (String((insErr as any)?.code ?? '') === '23505') return;
        lastErr = insErr;
        if (!isMissingColumnError(insErr)) break;
      }
      if (lastErr) throw lastErr;
      if (insertedId) await setInvoiceTransactionId({ supabase, businessId, invoiceId, transactionId: insertedId });
      return;
    }

    // If invoice_id column isn't present on transactions, fall back to invoices.transaction_id linkage.
    if (isMissingColumnError(selErr)) {
      const tidFromInvoice =
        Number(invoice?.transaction_id ?? 0) ||
        (await getInvoiceTransactionId({ supabase, businessId, invoiceId })) ||
        null;

      if (tidFromInvoice) {
        const { error: updErr } = await supabase
          .from('transactions')
          .update({
            date,
            amount: Math.abs(amount),
            category: 'Invoice',
            description,
            customer_name,
          } as any)
          .eq('business_id', businessId)
          .eq('id', tidFromInvoice);
        if (updErr) throw updErr;
        return;
      }

      // Create a transaction (without invoice_id column) and link it via invoices.transaction_id.
      const { data: inserted, error: insErr } = await supabase
        .from('transactions')
        .insert({
          business_id: businessId,
          date,
          amount: Math.abs(amount),
          category: 'Invoice',
          description,
          customer_name,
          customer_id: null,
        } as any)
        .select('id')
        .single();
      if (insErr) throw insErr;

      const tid = Number((inserted as any)?.id ?? 0) || null;
      if (tid) await setInvoiceTransactionId({ supabase, businessId, invoiceId, transactionId: tid });
      return;
    }

    throw selErr;
  } catch (e: any) {
    if (isMissingColumnError(e)) return;
    throw e;
  }
}

export async function deleteInvoiceLinkedTransactions(params: {
  supabase: SupabaseClient;
  businessId: string;
  invoiceId: number;
}) {
  const { supabase, businessId, invoiceId } = params;
  if (!invoiceId) return;
  try {
    // Preferred: delete by transactions.invoice_id.
    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('business_id', businessId)
      .eq('invoice_id', invoiceId);
    if (!error) {
      await setInvoiceTransactionId({ supabase, businessId, invoiceId, transactionId: null });
      return;
    }
    if (!isMissingColumnError(error)) throw error;

    // Fallback: invoice_id column missing on transactions -> delete by invoices.transaction_id.
    const tid = await getInvoiceTransactionId({ supabase, businessId, invoiceId });
    if (tid) {
      await supabase
        .from('transactions')
        .delete()
        .eq('business_id', businessId)
        .eq('id', tid);
    }
    await setInvoiceTransactionId({ supabase, businessId, invoiceId, transactionId: null });
  } catch (e: any) {
    if (isMissingColumnError(e)) return;
    throw e;
  }
}


