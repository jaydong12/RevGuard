'use client';

import React from 'react';
import Link from 'next/link';
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
  LineChart,
  Info,
  ChevronRight,
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

function Tooltip({
  title,
  what,
  bulletsTitle,
  calc,
  good,
}: {
  title: string;
  what: string;
  bulletsTitle?: string;
  calc: string[];
  good: string;
}) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 w-[280px] -translate-x-1/2 rounded-2xl border border-slate-800/80 bg-slate-950/80 backdrop-blur px-3 py-2 shadow-[0_18px_60px_rgba(0,0,0,0.45)] opacity-0 translate-y-1 transition group-hover:opacity-100 group-hover:translate-y-0">
      <div className="text-xs font-semibold text-slate-100">{title}</div>
      <div className="mt-1 text-[11px] text-slate-300 leading-relaxed">{what}</div>
      <div className="mt-2 text-[11px] text-slate-400">{bulletsTitle ?? 'How it’s scored'}</div>
      <ul className="mt-1 space-y-0.5 text-[11px] text-slate-300">
        {calc.slice(0, 4).map((c, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[6px] h-1.5 w-1.5 rounded-full bg-slate-600/80 shrink-0" />
            <span>{c}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 text-[11px] text-slate-300">
        <span className="text-slate-400">Interpretation:</span> {good}
      </div>
    </div>
  );
}

function InfoTip({
  title,
  what,
  bulletsTitle,
  calc,
  good,
}: {
  title: string;
  what: string;
  bulletsTitle?: string;
  calc: string[];
  good: string;
}) {
  return (
    <span className="group relative inline-flex items-center">
      <Info className="h-3.5 w-3.5 text-slate-500 group-hover:text-slate-200 transition" />
      <Tooltip title={title} what={what} bulletsTitle={bulletsTitle} calc={calc} good={good} />
    </span>
  );
}

function SegmentedBar({ score, state }: { score: number; state: HealthState }) {
  const pct = Math.max(0, Math.min(100, Math.round(score)));
  // Slightly fewer segments + thinner bars = calmer, more modern look.
  const segments = 18;
  const filled = Math.round((pct / 100) * segments);
  return (
    <div className="flex items-center gap-[3px]">
      {Array.from({ length: segments }).map((_, i) => {
        const on = i < filled;
        const rounded =
          i === 0 ? 'rounded-l-full' : i === segments - 1 ? 'rounded-r-full' : 'rounded-sm';
        return (
          <div
            key={i}
            className={`h-2 flex-1 ${rounded} ${
              on
                ? `bg-gradient-to-r ${barFillClasses(
                    state
                  )} shadow-[0_0_14px_rgba(56,189,248,0.10)]`
                : 'bg-white/[0.08]'
            }`}
          />
        );
      })}
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
    case 'forecastStability':
    default:
      return <LineChart className="h-4 w-4 text-violet-200" />;
  }
}

function HealthMetric({ pillar }: { pillar: HealthPillar }) {
  return (
    <div className="grid grid-cols-[1fr,64px] gap-3 items-center">
      <div className="space-y-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/5">
            {metricIcon(pillar.key)}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="text-xs font-medium text-slate-200 truncate">{pillar.label}</div>
              <InfoTip
                title={pillar.label}
                what={pillar.help.what}
                bulletsTitle={pillar.help.bulletsTitle}
                calc={pillar.help.calc}
                good={pillar.help.good}
              />
            </div>
          </div>
        </div>
        <SegmentedBar score={pillar.score} state={pillar.state} />
        {pillar.key === 'cashFlow' && pillar.whatThisMeans && (
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
  const { overallScore, overallState, overallHelp, todayVsTrend, pillars, fixFirst } = health;

  return (
    <div className="rg-enter rg-lift rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-6 shadow-[0_1px_0_rgba(255,255,255,0.04)] flex flex-col justify-between">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {/* Row 1: Title */}
          <div className="flex items-center gap-2">
            <div className="text-xs font-medium text-slate-200">Overall Health</div>
            <InfoTip
              title="Overall Health"
              what={overallHelp.what}
              calc={overallHelp.calc}
              good={overallHelp.good}
            />
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
        </div>
      </div>

      <div className="mt-5 grid gap-4">
        <HealthMetric pillar={pillars.cashFlow} />
        <HealthMetric pillar={pillars.profit} />
        <HealthMetric pillar={pillars.expenseControl} />
        <HealthMetric pillar={pillars.forecastStability} />
      </div>

      <div className="mt-5">
        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
          Fix this first
        </div>
        <ul className="mt-2 space-y-1.5 text-[11px] text-slate-300">
          {fixFirst.slice(0, 3).map((item, idx) => (
            <li key={idx} className="group">
              {item.href ? (
                <Link
                  href={item.href}
                  className="flex items-start justify-between gap-3 rounded-xl border border-white/5 bg-white/0 px-2.5 py-2 hover:bg-white/5 transition"
                >
                  <span className="leading-relaxed">{item.text}</span>
                  <ChevronRight className="h-4 w-4 text-slate-500 group-hover:text-slate-200 mt-0.5 shrink-0" />
                </Link>
              ) : (
                <div className="flex gap-2">
                  <span className="mt-[6px] h-1.5 w-1.5 rounded-full bg-slate-500/80 shrink-0" />
                  <span className="leading-relaxed">{item.text}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}


