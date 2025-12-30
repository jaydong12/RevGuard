import type { SupabaseClient } from '@supabase/supabase-js';

export async function createSmartInvoiceForBooking(params: {
  supabase: SupabaseClient;
  businessId: string;
  bookingId: number;
  clientName: string;
  serviceName: string;
  price: number;
  notes?: string | null;
  startAtIso?: string | null;
  endAtIso?: string | null;
}) {
  const {
    supabase,
    businessId,
    bookingId,
    clientName,
    serviceName,
    price,
    notes,
    startAtIso,
    endAtIso,
  } = params;

  const invNum = `INV-${Date.now()}`;
  const issueDate = new Date().toISOString().slice(0, 10);
  const dueDate = issueDate;
  const safePrice = Number.isFinite(Number(price)) ? Number(price) : 0;

  const bookingLine = startAtIso
    ? `Booking: ${startAtIso}${endAtIso ? ` → ${endAtIso}` : ''}`
    : null;

  const invoiceNotes = [notes?.trim() ? notes.trim() : null, bookingLine]
    .filter(Boolean)
    .join('\n');

  const payload: any = {
    business_id: businessId,
    invoice_number: invNum,
    client_name: clientName,
    issue_date: issueDate,
    due_date: dueDate,
    status: 'sent',
    subtotal: safePrice,
    tax: 0,
    total: safePrice,
    notes: invoiceNotes || null,
    source: 'booking',
    booking_id: bookingId,
  };

  const { data: invoice, error: iErr } = await supabase
    .from('invoices')
    .insert(payload)
    // Schema-safe: some DBs may not have amount_paid/balance_due yet.
    .select('*')
    .single();

  if (iErr || !invoice?.id) throw iErr ?? new Error('Failed to create invoice');

  // Create one line item
  const { error: itemErr } = await supabase.from('invoice_items').insert({
    invoice_id: invoice.id,
    description: serviceName,
    quantity: 1,
    unit_price: safePrice,
  } as any);
  if (itemErr) {
    // Non-fatal: invoice exists; caller may still proceed.
  }

  return invoice;
}

export async function appendInvoiceNote(params: {
  supabase: SupabaseClient;
  businessId: string;
  invoiceId: number;
  line: string;
}) {
  const { supabase, businessId, invoiceId, line } = params;
  const { data: existing, error: selErr } = await supabase
    .from('invoices')
    .select('id,notes')
    .eq('business_id', businessId)
    .eq('id', invoiceId)
    .maybeSingle();
  if (selErr) throw selErr;

  const prev = String((existing as any)?.notes ?? '').trim();
  const next = [prev || null, String(line || '').trim()].filter(Boolean).join('\n');

  const { error: updErr } = await supabase
    .from('invoices')
    .update({ notes: next } as any)
    .eq('business_id', businessId)
    .eq('id', invoiceId);
  if (updErr) throw updErr;
}


