'use client';

import React from 'react';
import { formatCurrency } from '../lib/formatCurrency';
import type { HealthPillar, HealthState, HealthSystemResult } from '../lib/healthSystem';

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

function dotClasses(state: HealthState) {
  switch (state) {
    case 'Healthy':
      return 'bg-emerald-400 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]';
    case 'Caution':
      return 'bg-sky-400 shadow-[0_0_0_4px_rgba(56,189,248,0.12)]';
    case 'At Risk':
      return 'bg-amber-400 shadow-[0_0_0_4px_rgba(251,191,36,0.12)]';
    case 'Critical':
    default:
      return 'bg-rose-400 shadow-[0_0_0_4px_rgba(244,63,94,0.12)]';
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
  const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '→';
  return `${arrow} ${Math.abs(pct)}%`;
}

function PillarBar({ pillar }: { pillar: HealthPillar }) {
  const pct = Math.max(0, Math.min(100, Math.round(pillar.score)));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 rounded-full ${dotClasses(pillar.state)}`} />
          <div className="text-xs text-slate-200 truncate">{pillar.label}</div>
        </div>
        <div className="text-[11px] font-semibold text-slate-200 tabular-nums">
          {pct}%
        </div>
      </div>
      <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${barFillClasses(
            pillar.state
          )} shadow-[0_0_18px_rgba(56,189,248,0.10)]`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function BusinessHealthSystemCard({ health }: { health: HealthSystemResult }) {
  const { overallScore, overallState, todayVsTrend, pillars, fixFirst } = health;

  return (
    <div className="rg-enter rg-lift rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-6 shadow-[0_1px_0_rgba(255,255,255,0.04)] flex flex-col justify-between">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
            Business health
          </div>

          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <div className="text-lg font-semibold text-slate-50 tracking-tight">
              Overall Health{' '}
              <span className="text-slate-200 tabular-nums">{overallScore}</span>
              <span className="text-slate-400 font-medium">/100</span>
            </div>
            <div className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] ${pillClasses(overallState)}`}>
              {overallState}
            </div>
          </div>

          <div className="mt-2 text-[11px] text-slate-300">
            <span className="text-slate-400">Today vs Trend:</span>{' '}
            <span className="font-semibold text-slate-100">
              Today: {formatCurrency(todayVsTrend.todayNet)}
            </span>{' '}
            <span className="text-slate-500">|</span>{' '}
            <span className="text-slate-300">
              7d: <span className="font-semibold text-slate-100">{formatPct(todayVsTrend.pct7d)}</span>
            </span>{' '}
            <span className="text-slate-500">|</span>{' '}
            <span className="text-slate-300">
              30d: <span className="font-semibold text-slate-100">{formatPct(todayVsTrend.pct30d)}</span>
            </span>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        <PillarBar pillar={pillars.cashFlow} />
        <PillarBar pillar={pillars.profit} />
        <PillarBar pillar={pillars.expenseControl} />
        <PillarBar pillar={pillars.forecastStability} />
      </div>

      <div className="mt-5">
        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
          Fix this first
        </div>
        <ul className="mt-2 space-y-1 text-[11px] text-slate-300">
          {fixFirst.slice(0, 3).map((t, idx) => (
            <li key={idx} className="flex gap-2">
              <span className="mt-[6px] h-1.5 w-1.5 rounded-full bg-slate-500/80 shrink-0" />
              <span className="leading-relaxed">{t}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}


