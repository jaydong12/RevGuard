'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatCurrency } from '../lib/formatCurrency';
import type {
  HealthPillar,
  HealthState,
  HealthSystemResult,
} from '../lib/healthSystem';
import {
  Activity,
  Info,
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

function borderClasses(state: HealthState) {
  switch (state) {
    case 'Healthy':
      return 'border-emerald-500/25 hover:border-emerald-400/40';
    case 'Caution':
      return 'border-sky-500/25 hover:border-sky-400/40';
    case 'At Risk':
      return 'border-amber-500/25 hover:border-amber-400/40';
    case 'Critical':
    default:
      return 'border-rose-500/25 hover:border-rose-400/40';
  }
}

function infoIconClasses(state: HealthState) {
  switch (state) {
    case 'Healthy':
      return 'text-emerald-200/80 hover:text-emerald-200';
    case 'Caution':
      return 'text-sky-200/80 hover:text-sky-200';
    case 'At Risk':
      return 'text-amber-200/80 hover:text-amber-200';
    case 'Critical':
    default:
      return 'text-rose-200/80 hover:text-rose-200';
  }
}

function formatPct(p: number | null) {
  if (p === null) return '—';
  const pct = Math.round(p * 100);
  const capped = Math.max(-999, Math.min(999, pct));
  const sign = capped > 0 ? '+' : capped < 0 ? '-' : '';
  return capped === 0 ? '0%' : `${sign}${Math.abs(capped)}%`;
}

function useIsTouchLike() {
  const [touchLike, setTouchLike] = useState(false);
  useEffect(() => {
    try {
      const coarse =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: coarse)').matches;
      setTouchLike(Boolean(coarse));
    } catch {
      setTouchLike(false);
    }
  }, []);
  return touchLike;
}

function InfoPopover({
  state,
  title,
  measures,
  why,
  changed,
  action,
}: {
  state: HealthState;
  title: string;
  measures: string;
  why: string;
  changed: string;
  action: string;
}) {
  const isTouchLike = useIsTouchLike();
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [active, setActive] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom');

  useEffect(() => {
    if (!open) {
      setActive(false);
      const t = window.setTimeout(() => setShown(false), 140);
      return () => window.clearTimeout(t);
    }
    setShown(true);
    const raf = window.requestAnimationFrame(() => setActive(true));
    return () => window.cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!shown) return;
    function computePos() {
      const btn = btnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const w = 340; // popover width target
      const h = popoverRef.current?.getBoundingClientRect().height ?? 240;
      const pad = 12;
      const gap = 10;

      // Center over the icon, then clamp to the viewport.
      const desiredLeft = r.left + r.width / 2 - w / 2;
      const left = Math.max(pad, Math.min(window.innerWidth - pad - w, desiredLeft));

      // Prefer below; if it would overflow, flip above.
      const belowTop = r.bottom + gap;
      const fitsBelow = belowTop + h + pad <= window.innerHeight;
      let top = belowTop;
      let place: 'bottom' | 'top' = 'bottom';

      if (!fitsBelow) {
        const aboveTop = r.top - gap - h;
        top = aboveTop;
        place = 'top';
      }

      // Final clamp to viewport
      top = Math.max(pad, Math.min(window.innerHeight - pad - h, top));

      setPlacement(place);
      setPos({ top, left });
    }
    computePos();
    window.addEventListener('scroll', computePos, true);
    window.addEventListener('resize', computePos);
    return () => {
      window.removeEventListener('scroll', computePos, true);
      window.removeEventListener('resize', computePos);
    };
  }, [shown]);

  // After the popover mounts, re-measure once so the flip logic can use the real height.
  useEffect(() => {
    if (!shown) return;
    const t = window.setTimeout(() => {
      const btn = btnRef.current;
      const pop = popoverRef.current;
      if (!btn || !pop) return;
      // Trigger computePos via a synthetic resize event.
      window.dispatchEvent(new Event('resize'));
    }, 0);
    return () => window.clearTimeout(t);
  }, [shown]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent | TouchEvent) {
      const btn = btnRef.current;
      const pop = popoverRef.current;
      const t = e.target as Node | null;
      if (!t) return;
      if (btn?.contains(t) || pop?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('touchstart', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('touchstart', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const content = useMemo(
    () => [
      { label: 'What it measures', text: measures },
      { label: 'Why it’s high/low', text: why },
      { label: 'What changed', text: changed },
      { label: 'One action', text: action },
    ],
    [measures, why, changed, action]
  );

  return (
    <span className="inline-flex">
      <button
        ref={btnRef}
        type="button"
        aria-label={`Info: ${title}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => {
          if (!isTouchLike) setOpen(true);
        }}
        onMouseLeave={() => {
          if (!isTouchLike) setOpen(false);
        }}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 transition ${infoIconClasses(
          state
        )}`}
      >
        <Info className="h-4 w-4" />
      </button>

      {shown && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              style={
                pos
                  ? {
                      position: 'fixed',
                      top: pos.top,
                      left: pos.left,
                      width: 340,
                      transformOrigin: placement === 'top' ? 'bottom left' : 'top left',
                    }
                  : { position: 'fixed', width: 340 }
              }
              className={`z-[9999] rounded-2xl border bg-slate-950/92 backdrop-blur shadow-[0_18px_60px_rgba(0,0,0,0.55)] ${borderClasses(
                state
              )} ${
                active
                  ? 'opacity-100 translate-y-0 scale-100'
                  : placement === 'top'
                    ? 'opacity-0 translate-y-1 scale-[0.985]'
                    : 'opacity-0 -translate-y-1 scale-[0.985]'
              } transition duration-150 ease-out`}
              onMouseEnter={() => {
                if (!isTouchLike) setOpen(true);
              }}
              onMouseLeave={() => {
                if (!isTouchLike) setOpen(false);
              }}
            >
              <div className="px-4 py-3 border-b border-white/10">
                <div className="text-xs font-semibold text-slate-100">{title}</div>
                <div className="mt-0.5 text-[11px] text-slate-400">
                  Tap outside to close
                </div>
              </div>
              <div className="px-4 py-3 space-y-3">
                {content.map((s) => (
                  <div key={s.label}>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                      {s.label}
                    </div>
                    <div className="mt-1 text-sm text-slate-200 leading-relaxed">
                      {s.text}
                    </div>
                  </div>
                ))}
              </div>
            </div>,
            document.body
          )
        : null}
    </span>
  );
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
  const tooltip = pillar.tooltip;
  return (
    <div
      className={`rounded-2xl border bg-white/[0.02] p-4 transition ${borderClasses(
        pillar.state
      )}`}
    >
      <div className="grid grid-cols-[1fr,64px] gap-4 items-start">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 min-w-0">
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

            {tooltip ? (
              <InfoPopover
                state={pillar.state}
                title={pillar.label}
                measures={tooltip.measures}
                why={tooltip.why}
                changed={tooltip.changed}
                action={tooltip.action}
              />
            ) : null}
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


