'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSupabaseClient, getSupabaseEnvError } from '../utils/supabaseClient';

type BusinessRow = {
  id: string;
  name: string | null;
  owner_id: string | null;
  subscription_status?: string | null;
  subscription_plan?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  logo_url?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  tax_entity_type?: string | null;
  tax_state?: string | null;
  tax_filing_status?: string | null;
  tax_state_rate?: number | null;
  tax_include_self_employment?: boolean | null;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  updated_at: string | null;
};

type AppData = {
  userId: string | null;
  userEmail: string | null;
  businessId: string | null;
  business: BusinessRow | null;
  memberRole: string | null;
  loading: boolean;
  error: string | null;
  transactions: any[];
  customers: any[];
  bills: any[];
  invoices: any[];
  profile: ProfileRow | null;
  profileLoading: boolean;
  profileError: string | null;
};

const AppDataContext = React.createContext<AppData | null>(null);

async function getSessionUser(): Promise<{ id: string | null; email: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { id: null, email: null };
  const { data } = await supabase.auth.getSession();
  return {
    id: data.session?.user?.id ?? null,
    email: data.session?.user?.email ?? null,
  };
}

async function fetchBusinessForOwner(userId: string): Promise<BusinessRow | null> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error(getSupabaseEnvError() ?? 'Supabase is not configured.');
  const res = await supabase
    .from('business')
    // Use '*' so older DBs missing newer columns (e.g. address1) don't throw.
    .select('*')
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (res.error) throw res.error;
  return (res.data as any) ?? null;
}

async function fetchBusinessById(businessId: string): Promise<BusinessRow | null> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error(getSupabaseEnvError() ?? 'Supabase is not configured.');
  const res = await supabase
    .from('business')
    .select('*')
    .eq('id', businessId)
    .maybeSingle();
  if (res.error) throw res.error;
  return (res.data as any) ?? null;
}

async function ensureBusinessForOwner(userId: string): Promise<BusinessRow | null> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error(getSupabaseEnvError() ?? 'Supabase is not configured.');
  const existing = await fetchBusinessForOwner(userId);
  if (existing?.id) return existing;

  const created = await supabase
    .from('business')
    .insert({ owner_id: userId, name: 'My Business' } as any)
    .select('*')
    .single();

  if (created.error) throw created.error;
  return (created.data as any) ?? null;
}

async function ensureProfileAndFetch(userId: string): Promise<ProfileRow | null> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error(getSupabaseEnvError() ?? 'Supabase is not configured.');
  // IMPORTANT: Do not insert/upsert here. Some environments enforce RLS rules that
  // block profile inserts. The Settings page will update-only if a row exists.
  const res = await supabase
    .from('profiles')
    // Use '*' so older DBs missing new columns (e.g. full_name) don't throw.
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (res.error) throw res.error;

  const row = (res.data as any) ?? null;
  if (!row) return null;

  // Normalize fields with safe null fallbacks.
  return {
    id: String(row.id),
    full_name: row.full_name ?? null,
    phone: row.phone ?? null,
    city: row.city ?? null,
    country: row.country ?? null,
    updated_at: row.updated_at ?? null,
  };
}

async function fetchAllRowsPaged<T = any>(params: {
  table: string;
  businessId: string;
  select?: string;
  orderBy?: { column: string; ascending: boolean };
}): Promise<T[]> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error(getSupabaseEnvError() ?? 'Supabase is not configured.');
  const pageSize = 1000;
  let from = 0;
  const all: any[] = [];
  while (true) {
    let q: any = supabase
      .from(params.table as any)
      .select(params.select ?? '*')
      .eq('business_id', params.businessId)
      .range(from, from + pageSize - 1);

    if (params.orderBy) {
      q = q.order(params.orderBy.column, { ascending: params.orderBy.ascending });
    }

    const { data, error } = await q;
    if (error) throw error;
    const batch = (data as any[]) ?? [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return all as T[];
}

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const supabase = getSupabaseClient();
  const envError = getSupabaseEnvError();

  const sessionQ = useQuery({
    queryKey: ['auth_session_user_id'],
    queryFn: getSessionUser,
    enabled: Boolean(supabase),
  });

  const userId = sessionQ.data?.id ?? null;
  const userEmail = sessionQ.data?.email ?? null;

  const memberQ = useQuery({
    queryKey: ['business_member_for_user', userId],
    enabled: Boolean(supabase && userId),
    queryFn: async () => {
      if (!supabase) throw new Error(envError ?? 'Supabase is not configured.');
      const { data, error } = await supabase
        .from('business_members')
        .select('business_id, role')
        .eq('user_id', userId!)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const row = (data as any) ?? null;
      if (!row?.business_id) return null;
      return { business_id: String(row.business_id), role: String(row.role ?? '').toLowerCase() };
    },
  });

  const memberRole = memberQ.data?.role ?? null;
  const memberBusinessId = memberQ.data?.business_id ?? null;
  const isEmployee = memberRole === 'employee';

  const businessQ = useQuery({
    queryKey: ['business_for_user', userId, memberBusinessId],
    enabled: Boolean(supabase && userId),
    queryFn: async () => {
      // Sub-accounts should NOT auto-create a business row.
      if (memberBusinessId) return await fetchBusinessById(memberBusinessId);
      return await ensureBusinessForOwner(userId!);
    },
  });

  const business = businessQ.data ?? null;
  const businessId = business?.id ?? null;

  const profileQ = useQuery({
    queryKey: ['profile', userId],
    enabled: Boolean(supabase && userId),
    queryFn: () => ensureProfileAndFetch(userId!),
  });

  const txQ = useQuery({
    queryKey: ['transactions', businessId],
    enabled: Boolean(supabase && userId && businessId && !isEmployee),
    queryFn: async () => {
      try {
        const rows = await fetchAllRowsPaged({
          table: 'transactions',
          businessId: businessId!,
          select: '*',
          orderBy: { column: 'date', ascending: false },
        });
        // Money standardization:
        // Prefer integer cents in `amount_cents`, and derive `amount` dollars once for legacy consumers.
        const normalized = (rows ?? []).map((r: any) => {
          const cents = Number(r?.amount_cents);
          if (Number.isFinite(cents) && cents !== 0) return { ...r, amount: cents / 100 };
          // Legacy/imported rows may have amount_cents default 0 while amount is set.
          const amt = typeof r?.amount === 'string' ? Number(String(r.amount).replace(/[^0-9.\-]/g, '')) : Number(r?.amount);
          if (Number.isFinite(amt) && amt !== 0) return { ...r, amount: amt };
          return r;
        });
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.log('TXQ_FETCH_OK', { business_id: businessId, count: (normalized ?? []).length });
        }
        return normalized;
      } catch (e: any) {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.error('TXQ_FETCH_ERROR', {
            business_id: businessId,
            code: e?.code ?? null,
            message: e?.message ?? String(e),
            details: e?.details ?? null,
            hint: e?.hint ?? null,
          });
        }
        throw e;
      }
    },
  });

  const customersQ = useQuery({
    queryKey: ['customers', businessId],
    enabled: Boolean(supabase && userId && businessId && !isEmployee),
    queryFn: () =>
      fetchAllRowsPaged({
        table: 'customers',
        businessId: businessId!,
        select: '*',
        orderBy: { column: 'created_at', ascending: false },
      }),
  });

  const billsQ = useQuery({
    queryKey: ['bills', businessId],
    enabled: Boolean(supabase && userId && businessId && !isEmployee),
    queryFn: () =>
      fetchAllRowsPaged({
        table: 'bills',
        businessId: businessId!,
        select: '*',
        orderBy: { column: 'due_date', ascending: true },
      }),
  });

  const invoicesQ = useQuery({
    queryKey: ['invoices', businessId],
    enabled: Boolean(supabase && userId && businessId && !isEmployee),
    queryFn: () =>
      fetchAllRowsPaged({
        table: 'invoices',
        businessId: businessId!,
        select:
          'id, business_id, invoice_number, client_name, issue_date, due_date, status, subtotal, tax, total, notes, transaction_id, created_at',
        orderBy: { column: 'created_at', ascending: false },
      }),
  });

  const loading =
    sessionQ.isLoading ||
    businessQ.isLoading ||
    profileQ.isLoading ||
    txQ.isLoading ||
    customersQ.isLoading ||
    billsQ.isLoading ||
    invoicesQ.isLoading;

  const errObj =
    envError ||
    sessionQ.error ||
    businessQ.error ||
    txQ.error ||
    customersQ.error ||
    billsQ.error ||
    invoicesQ.error;
  const error = errObj ? String((errObj as any)?.message ?? errObj) : null;

  const value: AppData = React.useMemo(
    () => ({
      userId,
      userEmail,
      businessId,
      business,
      memberRole,
      loading,
      error,
      transactions: (txQ.data as any[]) ?? [],
      customers: (customersQ.data as any[]) ?? [],
      bills: (billsQ.data as any[]) ?? [],
      invoices: (invoicesQ.data as any[]) ?? [],
      profile: (profileQ.data as any) ?? null,
      profileLoading: Boolean(profileQ.isLoading),
      profileError: profileQ.error
        ? String((profileQ.error as any)?.message ?? profileQ.error)
        : null,
    }),
    [
      userId,
      userEmail,
      businessId,
      business,
      memberRole,
      loading,
      error,
      txQ.data,
      customersQ.data,
      billsQ.data,
      invoicesQ.data,
      profileQ.data,
      profileQ.isLoading,
      profileQ.error,
    ]
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = React.useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}


