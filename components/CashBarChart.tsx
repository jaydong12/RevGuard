'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from 'recharts';

function fmt(value: unknown) {
  const n = Number(value) || 0;
  return Math.round(n).toLocaleString('en-US');
}

function parseTxDate(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  // Common case: YYYY-MM-DD stored as a date (no timezone). Parse as LOCAL date
  // to avoid UTC timezone shifting the day/month/year.
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
  loading?: boolean;
  animationKey?: string;
}

const CashBarChart: React.FC<CashBarChartProps> = ({
  transactions,
  selectedPeriod,
  onPeriodChange,
  loading = false,
  animationKey,
}) => {
  // Keep a ref for ResizeObserver when available, but do NOT block rendering on it.
  // Some environments may not support ResizeObserver; Recharts can still render.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerReady, setContainerReady] = useState(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (typeof (globalThis as any).ResizeObserver === 'undefined') {
      setContainerReady(true);
      return;
    }

    const update = () => {
      const r = el.getBoundingClientRect();
      setContainerReady(r.width > 0 && r.height > 0);
    };

    update();

    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Normalize transactions defensively for charting:
  // - amount coerced to number (NaN -> 0)
  // - invalid dates dropped
  // - sorted by date ascending for stable behaviour
  const normalizedTxs = useMemo(() => {
    const norm = transactions
      .map((tx) => {
        const d = parseTxDate(tx.date);
        if (!d) return null;
        const amtRaw = Number((tx as any)?.amount);
        const amt = Number.isFinite(amtRaw) ? amtRaw : 0;
        return { ...tx, amount: amt, __d: d };
      })
      .filter(Boolean) as Array<Transaction & { __d: Date }>;

    norm.sort((a, b) => a.__d.getTime() - b.__d.getTime());
    return norm;
  }, [transactions]);

  // Extract distinct years from the provided transactions.
  const years = useMemo(() => {
    const set = new Set<number>();
    for (const tx of normalizedTxs) {
      set.add(tx.__d.getFullYear());
    }
    return Array.from(set.values()).sort((a, b) => a - b);
  }, [normalizedTxs]);

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
    const yearTx = normalizedTxs.filter((tx) => tx.__d.getFullYear() === activeYear);

    // Aggregate per month
    for (const tx of yearTx) {
      const m = tx.__d.getMonth(); // 0–11
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
  }, [normalizedTxs, activeYear]);

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

    for (const tx of normalizedTxs) {
      const y = tx.__d.getFullYear();
      const entry = base.find((b) => b.year === y);
      if (!entry) continue;
      const amt = Number(tx.amount) || 0;
      if (amt >= 0) entry.income += amt;
      else entry.expenses += Math.abs(amt);
      entry.net += amt;
    }

    return base;
  }, [normalizedTxs, years]);

  const data = mode === 'year' ? yearlyData : monthlyData;

  const txCountInView = useMemo(() => {
    if (mode === 'year') return normalizedTxs.length;
    if (!activeYear) return 0;
    return normalizedTxs.filter((tx) => tx.__d.getFullYear() === activeYear).length;
  }, [mode, normalizedTxs, activeYear]);

  // (Intentionally no console logging here—keeps production clean.)

  const hasData = Boolean(activeYear && years.length > 0 && data.length > 0 && txCountInView > 0);
  const safeYear = activeYear ?? null;
  const currentYearIndex = safeYear ? years.indexOf(safeYear) : -1;
  const [activeBarIndex, setActiveBarIndex] = useState<number | null>(null);

  const chartTitle = useMemo(() => {
    if (!safeYear) return 'Cash overview';
    return mode === 'year' ? 'Cash overview (yearly)' : `Cash overview (${safeYear})`;
  }, [mode, safeYear]);

  const currency = useMemo(() => {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      });
    } catch {
      return null;
    }
  }, []);

  function formatUsd(v: number) {
    if (currency) return currency.format(v);
    return `$${fmt(v)}`;
  }

  function TooltipCard({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: any[];
    label?: any;
  }) {
    if (!active || !payload || payload.length === 0) return null;
    const entry = payload[0] ?? {};
    const net = Number(entry?.value ?? 0) || 0;
    const labelStr = String(label ?? '');
    const title =
      mode === 'year'
        ? labelStr
        : safeYear
        ? `${labelStr} ${safeYear}`
        : labelStr;

    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/70 backdrop-blur px-3 py-2 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
        <div className="text-[11px] text-slate-400">{title}</div>
        <div className="mt-1 text-sm font-semibold text-slate-100">
          {formatUsd(net)}
        </div>
        <div className="mt-0.5 text-[11px] text-slate-400">Net change</div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-[0_0_0_1px_rgba(148,163,184,0.06)]">
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
            disabled={!safeYear || currentYearIndex <= 0}
            className="rounded-md bg-slate-800 px-3 py-1 disabled:opacity-40"
          >
            ‹ Prev year
          </button>

          <span className="px-3 py-1 text-base font-semibold">
            {safeYear ?? '—'}
          </span>

          <button
            onClick={() => {
              if (currentYearIndex >= 0 && currentYearIndex < years.length - 1) {
                const nextYear = years[currentYearIndex + 1];
                onPeriodChange({
                  mode,
                  year: nextYear,
                  month: mode === 'month' ? selectedPeriod?.month : undefined,
                });
              }
            }}
            disabled={!safeYear || currentYearIndex >= years.length - 1}
            className="rounded-md bg-slate-800 px-3 py-1 disabled:opacity-40"
          >
            Next year ›
          </button>
        </div>

        <button
          onClick={() => {
            const latestYear = years[years.length - 1];
            if (!latestYear) return;
            onPeriodChange({
              mode,
              year: latestYear,
              month: mode === 'month' ? selectedPeriod?.month : undefined,
            });
          }}
          disabled={years.length === 0}
          className="text-xs text-slate-400 hover:text-slate-100 disabled:opacity-40"
        >
          Jump to latest year
        </button>
      </div>

      {/* Bar chart for Jan–Dec net change */}
      <div ref={containerRef} className="relative h-[260px] min-h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%" minHeight={260}>
          <BarChart
            key={animationKey}
            data={data}
            margin={{ top: 14, right: 20, bottom: 14, left: 20 }}
            barCategoryGap="22%"
            onMouseMove={(state: any) => {
              const idx = typeof state?.activeTooltipIndex === 'number' ? state.activeTooltipIndex : null;
              setActiveBarIndex(idx);
            }}
            onMouseLeave={() => setActiveBarIndex(null)}
          >
            <defs>
              <linearGradient id="rgGreen" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34D399" stopOpacity="0.95" />
                <stop offset="55%" stopColor="#22C55E" stopOpacity="0.75" />
                <stop offset="100%" stopColor="#16A34A" stopOpacity="0.65" />
              </linearGradient>
              <linearGradient id="rgRed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FB7185" stopOpacity="0.95" />
                <stop offset="60%" stopColor="#F43F5E" stopOpacity="0.78" />
                <stop offset="100%" stopColor="#E11D48" stopOpacity="0.68" />
              </linearGradient>
              <filter id="rgGlowG" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#34D399" floodOpacity="0.18" />
                <feDropShadow dx="0" dy="0" stdDeviation="10" floodColor="#38BDF8" floodOpacity="0.12" />
              </filter>
              <filter id="rgGlowR" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#FB7185" floodOpacity="0.16" />
              </filter>
            </defs>

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
              content={<TooltipCard />}
              cursor={{ fill: 'rgba(148,163,184,0.06)' }}
            />
            <Bar
              dataKey="net"
              name="Net change"
              isAnimationActive={true}
              animationDuration={520}
              animationEasing="ease-out"
              barSize={mode === 'year' ? 34 : 26}
              radius={[10, 10, 10, 10]}
            >
              {data.map((entry: any, idx: number) => {
                const net = Number(entry?.net ?? 0) || 0;
                const isPositive = net >= 0;
                const isActive = activeBarIndex === idx;
                return (
                  <Cell
                    key={`cell-${idx}`}
                    fill={isPositive ? 'url(#rgGreen)' : 'url(#rgRed)'}
                    stroke={isActive ? (isPositive ? '#34D399' : '#FB7185') : 'rgba(148,163,184,0.0)'}
                    strokeWidth={isActive ? 1.5 : 0}
                    opacity={activeBarIndex === null || isActive ? 1 : 0.55}
                    filter={isActive ? (isPositive ? 'url(#rgGlowG)' : 'url(#rgGlowR)') : undefined}
                    radius={10 as any}
                  />
                );
              })}

              <LabelList
                dataKey="net"
                content={(props: any) => {
                  const idx = props?.index as number;
                  if (activeBarIndex === null || idx !== activeBarIndex) return null;
                  const v = Number(props?.value ?? 0) || 0;
                  const x = Number(props?.x ?? 0) || 0;
                  const y = Number(props?.y ?? 0) || 0;
                  const w = Number(props?.width ?? 0) || 0;
                  const isPos = v >= 0;
                  const text = formatUsd(v);
                  return (
                    <g>
                      <text
                        x={x + w / 2}
                        y={isPos ? y - 10 : y + 18}
                        textAnchor="middle"
                        fill={isPos ? '#A7F3D0' : '#FDA4AF'}
                        fontSize="11"
                        fontWeight="600"
                      >
                        {text}
                      </text>
                    </g>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        {loading ? (
          <div className="absolute inset-0 rounded-xl border border-slate-800 bg-slate-950/60 backdrop-blur-sm">
            <div className="h-full w-full animate-pulse p-4">
              <div className="h-full w-full rounded-xl bg-slate-900/50" />
            </div>
          </div>
        ) : null}

        {!loading && !containerReady ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-400">
            Loading chart…
          </div>
        ) : null}

        {!loading && !hasData ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-[11px] text-slate-200">
              No data yet.
            </div>
          </div>
        ) : null}
      </div>

      {!loading && !hasData ? (
        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-[11px] text-slate-300">
          No data yet. Import transactions to see your cash overview.
        </div>
      ) : null}
    </div>
  );
};

CashBarChart.displayName = 'CashBarChart';
export default React.memo(CashBarChart);



