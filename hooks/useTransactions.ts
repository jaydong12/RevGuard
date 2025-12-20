/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import type { Transaction, TransactionStatus } from '../types/transactions';
import type { TransactionFilterState, HighLevelType } from '../components/TransactionFilters';
import { computeDateRange } from '../lib/transactionsDateHelpers';

export interface UseTransactionsResult {
  transactions: Transaction[];
  loading: boolean;
  error: string | null;
  filtered: Transaction[];
  categories: string[];
  reload: () => Promise<void>;
  inlineUpdate: (
    id: string,
    patch: Partial<Pick<Transaction, 'category' | 'status' | 'account'>>
  ) => Promise<void>;
  bulkAction: (
    action: 'mark-cleared' | 'mark-reconciled' | 'change-category' | 'delete',
    ids: string[],
    extra?: { category?: string }
  ) => Promise<void>;
}

function applyHighLevelType(
  tx: Transaction,
  typeTab: HighLevelType
): boolean {
  if (typeTab === 'all') return true;
  const t = tx.type;
  const inferred: HighLevelType =
    t ?? (tx.amount >= 0 ? 'income' : 'expense');
  return inferred === typeTab;
}

export function useTransactions(
  businessId: string | null,
  filters: TransactionFilterState
): UseTransactionsResult {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      if (!businessId) {
        setTransactions([]);
        setLoading(false);
        return;
      }

      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user?.id ?? null;
      if (!userId) {
        setError('Please log in to load transactions.');
        setTransactions([]);
        return;
      }

      const { from, to } = computeDateRange(
        filters.datePreset,
        filters.from,
        filters.to
      );

      let query = supabase
        .from('transactions')
        .select('*')
        .eq('business_id', businessId)
        .gte('date', from)
        .lte('date', to)
        .order('date', { ascending: false });

      if (filters.category !== 'all') {
        query = query.eq('category', filters.category);
      }

      if (filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }

      if (filters.typeTab === 'income') {
        query = query.gte('amount', 0);
      } else if (filters.typeTab === 'expense') {
        query = query.lt('amount', 0);
      } else if (filters.typeTab !== 'all') {
        query = query.eq('type', filters.typeTab);
      }

      const { data, error: qError } = await query;

      if (qError) {
        setError('Could not load transactions. Please check Supabase logs.');
        setTransactions([]);
        return;
      }

      const rows = (data ?? []) as any[];
      const mapped: Transaction[] = rows.map((row) => ({
        id: String(row.id),
        date: row.date ?? '',
        description: row.description ?? '',
        category: row.category ?? null,
        amount: Number(row.amount) || 0,
        type: (row.type as Transaction['type']) ?? null,
        account: (row.account as string | null) ?? null,
        status: (row.status as TransactionStatus | null) ?? null,
        source: (row.source as Transaction['source']) ?? null,
        notes: (row.notes as string | null) ?? null,
        business_id: row.business_id ?? null,
        created_at: row.created_at ?? null,
        updated_at: row.updated_at ?? null,
      }));

      setTransactions(mapped);
    } catch {
      setError('Could not load transactions. Please check Supabase logs.');
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    businessId,
    filters.datePreset,
    filters.from,
    filters.to,
    filters.category,
    filters.status,
    filters.typeTab,
  ]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const tx of transactions) {
      if (tx.category) set.add(tx.category);
    }
    return Array.from(set.values()).sort();
  }, [transactions]);

  const filtered = useMemo(() => {
    return transactions.filter((tx) => {
      if (!applyHighLevelType(tx, filters.typeTab)) return false;

      if (filters.search.trim()) {
        const needle = filters.search.trim().toLowerCase();
        const haystack = [
          tx.description,
          tx.category ?? '',
          tx.account ?? '',
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }

      return true;
    });
  }, [transactions, filters]);

  async function inlineUpdate(
    id: string,
    patch: Partial<Pick<Transaction, 'category' | 'status' | 'account'>>
  ) {
    setTransactions((prev) =>
      prev.map((tx) => (tx.id === id ? { ...tx, ...patch } : tx))
    );

    if (!businessId) {
      await load();
      return;
    }

    const { error: updError } = await supabase
      .from('transactions')
      .update(patch)
      .eq('id', id)
      .eq('business_id', businessId);

    if (updError) {
      await load();
    }
  }

  async function bulkAction(
    action: 'mark-cleared' | 'mark-reconciled' | 'change-category' | 'delete',
    ids: string[],
    extra?: { category?: string }
  ) {
    if (!ids.length) return;
    if (!businessId) return;

    if (action === 'delete') {
      const { error: delError } = await supabase
        .from('transactions')
        .delete()
        .eq('business_id', businessId)
        .in('id', ids);
      if (delError) {
        return;
      }
      setTransactions((prev) => prev.filter((tx) => !ids.includes(tx.id)));
      return;
    }

    const patch: Partial<Transaction> = {};
    if (action === 'mark-cleared') patch.status = 'cleared';
    if (action === 'mark-reconciled') patch.status = 'reconciled';
    if (action === 'change-category' && extra?.category) {
      patch.category = extra.category;
    }

    const { error: updError } = await supabase
      .from('transactions')
      .update(patch)
      .eq('business_id', businessId)
      .in('id', ids);
    if (updError) {
      return;
    }

    setTransactions((prev) =>
      prev.map((tx) =>
        ids.includes(tx.id) ? { ...tx, ...patch } : tx
      )
    );
  }

  return {
    transactions,
    loading,
    error,
    filtered,
    categories,
    reload: load,
    inlineUpdate,
    bulkAction,
  };
}


