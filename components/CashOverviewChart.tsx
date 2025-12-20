'use client';

import React, { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type Point = {
  date: string; // YYYY-MM-DD
  value: number;
};

function safeNumber(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function formatUsd(value: number) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    const s = Math.round(value).toLocaleString('en-US');
    return `$${s}`;
  }
}

function formatDateLabel(iso: string) {
  // iso: YYYY-MM-DD
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateFull(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: any[];
  label?: any;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const iso = String(label ?? '');
  const v = safeNumber(payload[0]?.value);
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-950/70 backdrop-blur px-3 py-2 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
      <div className="text-[11px] text-slate-400">{formatDateFull(iso)}</div>
      <div className="mt-1 text-sm font-semibold text-slate-100">{formatUsd(v)}</div>
      <div className="mt-0.5 text-[11px] text-slate-400">Cash balance</div>
    </div>
  );
}

export default function CashOverviewChart({
  data,
  loading,
}: {
  data: Point[];
  loading: boolean;
}) {
  const ids = useMemo(() => {
    const r = Math.random().toString(16).slice(2);
    return {
      stroke: `cashStroke_${r}`,
      fill: `cashFill_${r}`,
    };
  }, []);

  const normalized = useMemo(() => {
    const rows = (data ?? [])
      .map((p) => ({ date: String(p.date), value: safeNumber(p.value) }))
      .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date))
      .sort((a, b) => a.date.localeCompare(b.date));
    return rows;
  }, [data]);

  const hasData = normalized.length > 0;

  return (
    <div className="relative rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="h-[280px] min-h-[280px] w-full min-w-0">
        {loading ? (
          <div className="h-full w-full animate-pulse">
            <div className="h-full w-full rounded-xl border border-slate-800 bg-slate-900/40" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" minHeight={280}>
            <AreaChart data={normalized} margin={{ top: 10, right: 16, bottom: 10, left: 8 }}>
              <defs>
                <linearGradient id={ids.stroke} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#34D399" />
                  <stop offset="45%" stopColor="#38BDF8" />
                  <stop offset="100%" stopColor="#3B82F6" />
                </linearGradient>
                <linearGradient id={ids.fill} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34D399" stopOpacity={0.22} />
                  <stop offset="55%" stopColor="#38BDF8" stopOpacity={0.12} />
                  <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.0} />
                </linearGradient>
              </defs>

              <CartesianGrid
                stroke="rgba(148, 163, 184, 0.16)"
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tickFormatter={(v: string) => formatDateLabel(String(v))}
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                axisLine={{ stroke: '#334155', strokeWidth: 1 }}
                tickLine={{ stroke: '#334155', strokeWidth: 1 }}
                minTickGap={18}
              />
              <YAxis
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                axisLine={{ stroke: '#334155', strokeWidth: 1 }}
                tickLine={{ stroke: '#334155', strokeWidth: 1 }}
                tickFormatter={(v: number) => {
                  const n = safeNumber(v);
                  // compact-ish: show $0, $1k, $10k
                  const abs = Math.abs(n);
                  if (abs >= 1_000_000) return `$${Math.round(n / 1_000_000)}M`;
                  if (abs >= 1_000) return `$${Math.round(n / 1_000)}k`;
                  return `$${Math.round(n)}`;
                }}
                width={44}
              />

              <Tooltip
                content={<CustomTooltip />}
                cursor={{ stroke: 'rgba(148,163,184,0.35)', strokeDasharray: '4 4' }}
              />

              <Area
                type="monotone"
                dataKey="value"
                stroke={`url(#${ids.stroke})`}
                fill={`url(#${ids.fill})`}
                strokeWidth={2.5}
                fillOpacity={1}
                dot={false}
                activeDot={{
                  r: 5,
                  fill: '#0b1220',
                  stroke: '#34D399',
                  strokeWidth: 2,
                }}
                style={{
                  filter: 'drop-shadow(0 0 14px rgba(52,211,153,0.18)) drop-shadow(0 0 24px rgba(56,189,248,0.14))',
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}

        {!loading && !hasData ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-slate-200 backdrop-blur">
              No data yet. Import transactions to see your cash curve.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}


