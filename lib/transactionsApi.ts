'use client';

import { supabase } from '../utils/supabaseClient';

/**
 * Load transactions for a given business using the Supabase client.
 *
 * - If businessId is missing, returns [] and does not call Supabase.
 * - If Supabase returns an error, logs it and returns [].
 * - Uses only real columns from public.transactions.
 */
export async function getTransactionsForBusiness(
  businessId: string | null | undefined
): Promise<any[]> {
  if (!businessId) {
    return [];
  }

  const { data, error } = await supabase
    .from('transactions')
    .select('id, date, description, category, amount, business_id, created_at')
    .eq('business_id', businessId)
    .order('date', { ascending: true });

  if (error) {
    // eslint-disable-next-line no-console
    console.error('transactions fetch failed', error);
    return [];
  }

  return data ?? [];
}


