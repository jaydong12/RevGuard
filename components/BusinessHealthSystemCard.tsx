'use client';

import React from 'react';
import { formatCurrency } from '../lib/formatCurrency';
import type {
  HealthPillar,
  HealthState,
  HealthSystemResult,
} from '../lib/healthSystem';
import {
  Activity,
  TrendingUp,
  Wallet,
} from 'lucide-react';

function pillClasses(state: HealthState) {
  switch (state) {
    case 'Healthy':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
    case 'Caution':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-200';
    case 'At Risk':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
    case 'Critical':
    default:
      return 'border-rose-500/30 bg-rose-500/10 text-rose-200';
  }
}

function barFillClasses(state: HealthState) {
  switch (state) {
    case 'Healthy':
      return 'from-emerald-400/90 via-emerald-400/70 to-emerald-500/60';
    case 'Caution':
      return 'from-sky-400/90 via-sky-400/70 to-blue-500/60';
    case 'At Risk':
      return 'from-amber-400/90 via-amber-400/70 to-orange-500/60';
    case 'Critical':
    default:
      return 'from-rose-400/90 via-rose-400/70 to-rose-500/60';
  }
}

function formatPct(p: number | null) {
  if (p === null) return '—';
  const pct = Math.round(p * 100);
  const capped = Math.max(-999, Math.min(999, pct));
  const sign = capped > 0 ? '+' : capped < 0 ? '-' : '';
  return capped === 0 ? '0%' : `${sign}${Math.abs(capped)}%`;
}

function ProgressBar({ score, state }: { score: number; state: HealthState }) {
  const pct = Math.max(0, Math.min(100, Math.round(score)));
  return (
    <div className="h-6 sm:h-7 rounded-full bg-white/[0.08] overflow-hidden border border-white/10">
      <div
        className={`h-full rounded-full bg-gradient-to-r ${barFillClasses(state)}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function metricIcon(key: HealthPillar['key']) {
  switch (key) {
    case 'cashFlow':
      return <Activity className="h-4 w-4 text-emerald-200" />;
    case 'profit':
      return <TrendingUp className="h-4 w-4 text-sky-200" />;
    case 'expenseControl':
      return <Wallet className="h-4 w-4 text-amber-200" />;
    default:
      return <Activity className="h-4 w-4 text-slate-200" />;
  }
}

function HealthMetric({ pillar }: { pillar: HealthPillar }) {
  return (
    <div className="grid grid-cols-[1fr,64px] gap-4 items-start">
      <div className="space-y-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
            {metricIcon(pillar.key)}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="text-xs font-medium text-slate-200 truncate">{pillar.label}</div>
            </div>
          </div>
        </div>
        <ProgressBar score={pillar.score} state={pillar.state} />
        {pillar.whatThisMeans && (
          <div className="text-[11px] text-slate-400 leading-relaxed">
            {pillar.whatThisMeans}
          </div>
        )}
      </div>
      <div className="text-right text-[11px] text-slate-400 tabular-nums">
        {Math.max(0, Math.min(100, Math.round(pillar.score)))}%
      </div>
    </div>
  );
}

export default function BusinessHealthSystemCard({ health }: { health: HealthSystemResult }) {
  const { overallScore, overallState, overallHelp, todayVsTrend, pillars } = health;

  return (
    <div className="rg-enter rg-lift rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-6 shadow-[0_1px_0_rgba(255,255,255,0.04)] flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {/* Row 1: Title */}
          <div className="flex items-center gap-2">
            <div className="text-xs font-medium text-slate-200">Overall Health</div>
          </div>

          {/* Row 2: Score + status */}
          <div className="mt-3 flex items-end justify-between gap-3 flex-wrap">
            <div className="text-4xl font-semibold tracking-tight text-slate-50 tabular-nums leading-none">
              {overallScore}
              <span className="text-base text-slate-500 font-medium">/100</span>
            </div>
            <div
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] ${pillClasses(
                overallState
              )}`}
            >
              {overallState}
            </div>
          </div>

          {/* Row 3: Stats */}
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
              <div className="flex items-center gap-1.5">
                <span>Today</span>
                <span className="text-slate-200 font-semibold">
                  {formatCurrency(todayVsTrend.todayNet)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span>7d</span>
                <span className="text-slate-200 font-semibold">
                  {formatPct(todayVsTrend.pct7d)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span>30d</span>
                <span className="text-slate-200 font-semibold">
                  {formatPct(todayVsTrend.pct30d)}
                </span>
              </div>
            </div>
          </div>

          {/* Always-visible description text (no tooltips). */}
          <div className="mt-4 text-[11px] text-slate-400 leading-relaxed">
            {overallHelp?.good ?? ''}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="grid gap-7">
            <HealthMetric pillar={pillars.cashFlow} />
            <HealthMetric pillar={pillars.profit} />
            <HealthMetric pillar={pillars.expenseControl} />
          </div>
        </div>
      </div>
    </div>
  );
}


