'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

function fmt(value: unknown) {
  const n = Number(value) || 0;
  return Math.round(n).toLocaleString('en-US');
}

// Local transaction shape for this chart. Adapted to the app's transactions.
type Transaction = {
  id: number;
  date: string; // ISO date
  amount: number; // +income, -expense
  category?: string;
  description?: string;
};

type PeriodMode = 'month' | 'year';

type SelectedPeriod = {
  mode: PeriodMode;
  year: number;
  month?: number; // 0–11 when mode === 'month'
};

interface CashBarChartProps {
  transactions: Transaction[];
  selectedPeriod: SelectedPeriod | null;
  onPeriodChange: (p: SelectedPeriod) => void;
}

const CashBarChart: React.FC<CashBarChartProps> = ({
  transactions,
  selectedPeriod,
  onPeriodChange,
}) => {
  // Extract distinct years from the provided transactions.
  const years = useMemo(() => {
    const ys = Array.from(
      new Set(
        transactions.map((tx) => new Date(tx.date).getFullYear())
      )
    ).sort((a, b) => a - b);
    return ys;
  }, [transactions]);

  const activeYear =
    selectedPeriod?.year ?? (years.length > 0 ? years[years.length - 1] : null);

  const mode: PeriodMode = selectedPeriod?.mode ?? 'month';

  // Aggregate transactions into 12 months (Jan–Dec) for the selected year.
  const monthlyData = useMemo(() => {
    if (!activeYear) return [] as {
      monthIndex: number;
      label: string;
      income: number;
      expenses: number;
      net: number;
    }[];

    // Start with 12 empty months
    const base = Array.from({ length: 12 }, (_, idx) => ({
      monthIndex: idx,
      label: new Date(2024, idx, 1).toLocaleString('en-US', {
        month: 'short',
      }), // Jan, Feb, ...
      income: 0,
      expenses: 0,
      net: 0,
    }));

    // Filter to the active year
    const yearTx = transactions.filter((tx) => {
      const d = new Date(tx.date);
      return d.getFullYear() === activeYear;
    });

    // Aggregate per month
    for (const tx of yearTx) {
      const d = new Date(tx.date);
      const m = d.getMonth(); // 0–11
      const entry = base[m];
      const amt = Number(tx.amount) || 0;

      if (amt >= 0) {
        entry.income += amt;
      } else {
        entry.expenses += Math.abs(amt);
      }
      entry.net += amt;
    }

    return base;
  }, [transactions, activeYear]);

  // Yearly aggregation for "year" mode: one bar per year.
  const yearlyData = useMemo(() => {
    if (years.length === 0) return [] as {
      year: number;
      label: string;
      income: number;
      expenses: number;
      net: number;
    }[];

    const base = years.map((y) => ({
      year: y,
      label: String(y),
      income: 0,
      expenses: 0,
      net: 0,
    }));

    for (const tx of transactions) {
      const d = new Date(tx.date);
      const y = d.getFullYear();
      const entry = base.find((b) => b.year === y);
      if (!entry) continue;
      const amt = Number(tx.amount) || 0;
      if (amt >= 0) entry.income += amt;
      else entry.expenses += Math.abs(amt);
      entry.net += amt;
    }

    return base;
  }, [transactions, years]);

  const data = mode === 'year' ? yearlyData : monthlyData;

  // If no data yet, show an empty state.
  if (!activeYear || years.length === 0 || data.length === 0) {
    return (
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 text-sm text-slate-300">
        No transactions yet. Import a CSV to see your cash by month.
      </div>
    );
  }

  const currentYearIndex = years.indexOf(activeYear);

  return (
    <div className="rounded-xl bg-slate-900 border border-slate-800 p-6">
      {/* Year navigation */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-slate-200">
          <button
            onClick={() => {
              if (currentYearIndex > 0) {
                const nextYear = years[currentYearIndex - 1];
                onPeriodChange({
                  mode,
                  year: nextYear,
                  month: mode === 'month' ? selectedPeriod?.month : undefined,
                });
              }
            }}
            disabled={currentYearIndex <= 0}
            className="rounded-md bg-slate-800 px-3 py-1 disabled:opacity-40"
          >
            ‹ Prev year
          </button>

          <span className="px-3 py-1 text-base font-semibold">
            {activeYear}
          </span>

          <button
            onClick={() => {
              if (currentYearIndex < years.length - 1) {
                const nextYear = years[currentYearIndex + 1];
                onPeriodChange({
                  mode,
                  year: nextYear,
                  month: mode === 'month' ? selectedPeriod?.month : undefined,
                });
              }
            }}
            disabled={currentYearIndex >= years.length - 1}
            className="rounded-md bg-slate-800 px-3 py-1 disabled:opacity-40"
          >
            Next year ›
          </button>
        </div>

        <button
          onClick={() => {
            const latestYear = years[years.length - 1];
            onPeriodChange({
              mode,
              year: latestYear,
              month: mode === 'month' ? selectedPeriod?.month : undefined,
            });
          }}
          className="text-xs text-slate-400 hover:text-slate-100"
        >
          Jump to latest year
        </button>
      </div>

      {/* Bar chart for Jan–Dec net change */}
      <div className="h-[320px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 10, right: 20, bottom: 20, left: 20 }}
          >
            <CartesianGrid
              stroke="rgba(148, 163, 184, 0.18)"
              strokeDasharray="2 2"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fill: '#94a3b8', fontSize: 10 }}
              axisLine={{ stroke: '#475569', strokeWidth: 1 }}
              tickLine={{ stroke: '#475569', strokeWidth: 1 }}
            />
            <YAxis
              tick={{ fill: '#94a3b8', fontSize: 10 }}
              axisLine={{ stroke: '#475569', strokeWidth: 1 }}
              tickLine={{ stroke: '#475569', strokeWidth: 1 }}
              tickFormatter={(v: number) => fmt(v)}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#020617',
                borderRadius: 8,
                border: '1px solid #1e293b',
                fontSize: 12,
                color: '#ffffff',
              }}
              labelStyle={{ color: '#ffffff' }}
              itemStyle={{ color: '#ffffff' }}
              formatter={(value: any, name: any) => {
                const v = Number(value) || 0;
                if (name === 'net') {
                  return [fmt(v), 'Net change'];
                }
                if (name === 'income') {
                  return [fmt(v), 'Income'];
                }
                if (name === 'expenses') {
                  return [fmt(v), 'Expenses'];
                }
                return fmt(v);
              }}
            />
            <Bar
              dataKey="net"
              name="Net change"
              isAnimationActive={false}
              radius={[6, 6, 0, 0]}
            >
              {data.map((entry: any, idx: number) => {
                const net = Number(entry?.net ?? 0) || 0;
                const isPositive = net >= 0;
                return (
                  <Cell
                    key={`cell-${idx}`}
                    fill={isPositive ? '#22c55e' : '#fb7185'}
                    radius={isPositive ? [6, 6, 0, 0] : [0, 0, 6, 6]}
                  />
                );
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

CashBarChart.displayName = 'CashBarChart';
export default React.memo(CashBarChart);



