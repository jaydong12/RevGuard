'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { useAppData } from './AppDataProvider';
import CashBarChart from './CashBarChart';

type TransactionRow = {
  id: number;
  date: string;
  amount: number;
  category?: string | null;
  description?: string | null;
};

type PeriodMode = 'month' | 'year';
type SelectedPeriod = { mode: PeriodMode; year: number; month?: number };

export function CashOverviewGate() {
  const { businessId } = useAppData();
  const bid = typeof businessId === 'string' ? businessId.trim() : '';
  if (!bid) return null;
  return <CashOverviewInner businessId={bid} />;
}

function CashOverviewInner({ businessId }: { businessId: string }) {
  // If businessId ever becomes empty, do not fetch and render nothing (paranoia guard).
  const safeBusinessId = typeof businessId === 'string' ? businessId.trim() : '';

  const [loading, setLoading] = useState(true);
  const [txs, setTxs] = useState<TransactionRow[]>([]);

  // CashBarChart needs a selectedPeriod + callback.
  const [selectedPeriod, setSelectedPeriod] = useState<SelectedPeriod | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!safeBusinessId) {
        setTxs([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        // Supabase/PostgREST often defaults to a 1k row cap. Paginate so the chart can
        // navigate across ALL available years (not just the newest ~1000 rows).
        const pageSize = 1000;
        let from = 0;
        const all: any[] = [];

        while (true) {
          const { data, error } = await supabase
            .from('transactions')
            .select('id,date,amount,category,description')
            .eq('business_id', safeBusinessId)
            .order('date', { ascending: true })
            .range(from, from + pageSize - 1);

          if (cancelled) return;

          if (error) {
            setTxs([]);
            setLoading(false);
            return;
          }

          const batch = Array.isArray(data) ? data : [];
          all.push(...batch);

          if (batch.length < pageSize) break;
          from += pageSize;
        }

        const mapped = all.map((r: any) => ({
          id: Number(r?.id) || 0,
          date: typeof r?.date === 'string' ? String(r.date) : '',
          amount: Number(r?.amount) || 0,
          category: r?.category ?? null,
          description: r?.description ?? null,
        })) as TransactionRow[];

        setTxs(mapped.filter((r) => Boolean(r.date)));
      } catch {
        if (!cancelled) setTxs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [safeBusinessId]);

  const chartTxs = useMemo(() => {
    const rows = Array.isArray(txs) ? txs : [];
    // Chart expects numbers + non-empty date strings. Keep it minimal.
    return rows.filter((r) => typeof r.date === 'string' && r.date);
  }, [txs]);

  // Initialize the period to the latest year we can infer.
  useEffect(() => {
    if (!Array.isArray(chartTxs) || chartTxs.length === 0) return;
    if (selectedPeriod) return;
    const years = chartTxs
      .map((t) => new Date(String(t.date)).getFullYear())
      .filter((y) => Number.isFinite(y))
      .sort((a, b) => a - b);
    const latest = years[years.length - 1];
    if (!latest) return;
    setSelectedPeriod({ mode: 'month', year: latest, month: new Date().getMonth() });
  }, [chartTxs, selectedPeriod]);

  return (
    <section className="mb-8">
      <div className="flex justify-between items-center mb-2 text-[11px] text-slate-300">
        <span>Cash overview</span>
      </div>

      {safeBusinessId
        ? loading
          ? (
            <div className="min-h-[260px] rounded-2xl border border-slate-800 bg-slate-950/80 animate-pulse" />
          )
          : (
            <CashBarChart
              transactions={chartTxs as any}
              selectedPeriod={selectedPeriod as any}
              onPeriodChange={(p: any) => setSelectedPeriod(p)}
              loading={false}
              animationKey="cash"
            />
          )
        : null}
    </section>
  );
}


