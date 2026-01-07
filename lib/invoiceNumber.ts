import type { SupabaseClient } from '@supabase/supabase-js';

function parseSequence(prefix: string, invoiceNumber: any): number | null {
  const raw = String(invoiceNumber ?? '').trim();
  if (!raw.startsWith(prefix)) return null;
  const tail = raw.slice(prefix.length);
  if (!/^\d+$/.test(tail)) return null;
  const n = Number(tail);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export async function generateInvoiceNumber(params: {
  supabase: SupabaseClient;
  businessId: string;
  now?: Date;
}) {
  const { supabase, businessId } = params;
  const now = params.now ?? new Date();
  const year = now.getFullYear();
  const prefix = `INV-${year}-`;

  // Find recent invoices with this year prefix, then compute next sequence in JS.
  // (Ordering/limit avoids pulling too much data; the pad keeps IDs lexicographically sortable.)
  const { data, error } = await supabase
    .from('invoices')
    .select('invoice_number,created_at')
    .eq('business_id', businessId)
    .ilike('invoice_number', `${prefix}%`)
    .order('created_at', { ascending: false })
    .limit(250);

  if (error) throw error;

  let maxSeq = 0;
  for (const row of (data ?? []) as any[]) {
    const n = parseSequence(prefix, (row as any)?.invoice_number);
    if (n && n > maxSeq) maxSeq = n;
  }

  const next = maxSeq + 1;
  // Keep at least 3 digits (001), grow if needed (e.g. 1000).
  const width = Math.max(3, String(next).length);
  return `${prefix}${String(next).padStart(width, '0')}`;
}


