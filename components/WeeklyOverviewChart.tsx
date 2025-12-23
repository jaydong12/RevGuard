'use client';

import React, { useMemo } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type Transaction = {
  id: number;
  date: string; // YYYY-MM-DD
  amount: number; // +income, -expense
};

type Row = {
  key: string; // YYYY-MM-DD
  label: string; // Mon, Tue...
  fullLabel: string; // Tue, Dec 23
  income: number;
  expenses: number;
  net: number;
};

function parseTxDate(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [yy, mm, dd] = raw.split('-').map((x) => parseInt(x, 10));
    const d = new Date(yy, (mm ?? 1) - 1, dd ?? 1);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function fmtUsd0(n: number): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    const x = Math.round(n).toLocaleString('en-US');
    return `$${x}`;
  }
}

function fmtUsdShort(n: number): string {
  const x = Number(n) || 0;
  const abs = Math.abs(x);
  if (abs >= 1_000_000) return `${x < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${x < 0 ? '-' : ''}$${Math.round(abs / 1_000)}k`;
  return fmtUsd0(x);
}

function TooltipCard({
  active,
  payload,
}: {
  active?: boolean;
  payload?: any[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row: Row | undefined = payload?.[0]?.payload;
  if (!row) return null;

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-950/70 backdrop-blur px-3 py-2 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
      <div className="text-[11px] text-slate-400">{row.fullLabel}</div>
      <div className="mt-2 grid gap-1 text-[11px] text-slate-200">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">Income</span>
          <span className="font-semibold text-emerald-200">{fmtUsd0(row.income)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">Expenses</span>
          <span className="font-semibold text-rose-200">{fmtUsd0(row.expenses)}</span>
        </div>
        <div className="flex items-center justify-between gap-4 pt-1 border-t border-slate-800/80">
          <span className="text-slate-400">Net</span>
          <span className="font-semibold text-slate-100">{fmtUsd0(row.net)}</span>
        </div>
      </div>
    </div>
  );
}

export default function WeeklyOverviewChart({
  transactions,
  showNetLine = true,
  title = 'Weekly Overview',
}: {
  transactions: Transaction[];
  showNetLine?: boolean;
  title?: string;
}) {
  const data = useMemo<Row[]>(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // Week starts Sunday (0) and ends Saturday (6).
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay());

    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }

    const sums: Record<string, { income: number; expenses: number }> = {};
    for (const d of days) sums[dayKey(d)] = { income: 0, expenses: 0 };

    for (const tx of transactions) {
      const d = parseTxDate(tx.date);
      if (!d) continue;
      const k = dayKey(d);
      if (!sums[k]) continue;
      const amt = Number((tx as any)?.amount) || 0;
      if (amt >= 0) sums[k].income += amt;
      else sums[k].expenses += Math.abs(amt);
    }

    return days.map((d) => {
      const k = dayKey(d);
      const w = d.toLocaleDateString('en-US', { weekday: 'short' });
      const full = d.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
      const income = sums[k]?.income ?? 0;
      const expenses = sums[k]?.expenses ?? 0;
      return { key: k, label: w, fullLabel: full, income, expenses, net: income - expenses };
    });
  }, [transactions]);

  const hasAny = useMemo(() => data.some((d) => d.income !== 0 || d.expenses !== 0), [data]);

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-[0_0_0_1px_rgba(148,163,184,0.06)]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-100">{title}</div>
          <div className="mt-1 text-[11px] text-slate-400">This week (Sun–Sat)</div>
        </div>
      </div>

      <div className="relative h-[260px] min-h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%" minHeight={260}>
          <ComposedChart data={data} margin={{ top: 14, right: 18, bottom: 10, left: 8 }}>
            <defs>
              <linearGradient id="rg_week_income" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34D399" stopOpacity="0.95" />
                <stop offset="70%" stopColor="#16A34A" stopOpacity="0.70" />
                <stop offset="100%" stopColor="#0F766E" stopOpacity="0.55" />
              </linearGradient>
              <linearGradient id="rg_week_expenses" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FB7185" stopOpacity="0.95" />
                <stop offset="70%" stopColor="#E11D48" stopOpacity="0.70" />
                <stop offset="100%" stopColor="#9F1239" stopOpacity="0.55" />
              </linearGradient>
              <linearGradient id="rg_week_net" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#60A5FA" stopOpacity="0.85" />
              </linearGradient>
            </defs>

            <CartesianGrid stroke="rgba(148,163,184,0.14)" vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              tickFormatter={(v) => fmtUsdShort(Number(v) || 0)}
              width={56}
            />

            <Tooltip content={<TooltipCard />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />

            <Bar
              dataKey="income"
              name="Income"
              fill="url(#rg_week_income)"
              radius={[10, 10, 10, 10]}
              barSize={14}
            />
            <Bar
              dataKey="expenses"
              name="Expenses"
              fill="url(#rg_week_expenses)"
              radius={[10, 10, 10, 10]}
              barSize={14}
            />
            {showNetLine && (
              <Line
                type="monotone"
                dataKey="net"
                name="Net"
                stroke="url(#rg_week_net)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#60A5FA', stroke: '#0B1220', strokeWidth: 2 }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>

        {!hasAny && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-2 text-[11px] text-slate-300">
              Add transactions to unlock your weekly overview.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


