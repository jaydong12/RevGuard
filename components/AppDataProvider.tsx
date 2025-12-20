'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../utils/supabaseClient';

type BusinessRow = {
  id: string;
  name: string | null;
  owner_id: string | null;
  subscription_status?: string | null;
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
  const { data } = await supabase.auth.getSession();
  return {
    id: data.session?.user?.id ?? null,
    email: data.session?.user?.email ?? null,
  };
}

async function fetchBusinessForOwner(userId: string): Promise<BusinessRow | null> {
  const res = await supabase
    .from('business')
    .select('id, name, owner_id, subscription_status')
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (res.error) throw res.error;
  return (res.data as any) ?? null;
}

async function ensureProfileAndFetch(userId: string): Promise<ProfileRow | null> {
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
  const sessionQ = useQuery({
    queryKey: ['auth_session_user_id'],
    queryFn: getSessionUser,
  });

  const userId = sessionQ.data?.id ?? null;
  const userEmail = sessionQ.data?.email ?? null;

  const businessQ = useQuery({
    queryKey: ['business_by_owner', userId],
    enabled: Boolean(userId),
    queryFn: () => fetchBusinessForOwner(userId!),
  });

  const business = businessQ.data ?? null;
  const businessId = business?.id ?? null;

  const profileQ = useQuery({
    queryKey: ['profile', userId],
    enabled: Boolean(userId),
    queryFn: () => ensureProfileAndFetch(userId!),
  });

  const txQ = useQuery({
    queryKey: ['transactions', businessId],
    enabled: Boolean(userId && businessId),
    queryFn: () =>
      fetchAllRowsPaged({
        table: 'transactions',
        businessId: businessId!,
        select: '*',
        orderBy: { column: 'date', ascending: false },
      }),
  });

  const customersQ = useQuery({
    queryKey: ['customers', businessId],
    enabled: Boolean(userId && businessId),
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
    enabled: Boolean(userId && businessId),
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
    enabled: Boolean(userId && businessId),
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

  const businessMissing =
    Boolean(userId) && !businessQ.isLoading && !businessQ.error && !businessId;

  const errObj =
    sessionQ.error ||
    businessQ.error ||
    txQ.error ||
    customersQ.error ||
    billsQ.error ||
    invoicesQ.error;
  const error = businessMissing
    ? 'No business selected. Please finish setup or refresh—your business should be created automatically after signup.'
    : errObj
      ? String((errObj as any)?.message ?? errObj)
      : null;

  const value: AppData = React.useMemo(
    () => ({
      userId,
      userEmail,
      businessId,
      business,
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


