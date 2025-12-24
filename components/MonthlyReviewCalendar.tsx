'use client';

import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export type ReviewDayProgress = {
  day: string; // YYYY-MM-DD
  transactions: boolean;
  categories: boolean;
  biggest_move: boolean;
};

type ProgressMap = Record<
  string,
  { transactions: boolean; categories: boolean; biggest_move: boolean }
>;

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function monthLabel(d: Date): string {
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function dayClass(state: 'empty' | 'none' | 'partial' | 'full', isToday: boolean): string {
  const base =
    'relative flex h-10 w-10 items-center justify-center rounded-xl text-xs transition select-none';
  const todayRing = isToday ? ' ring-2 ring-emerald-400/60 ring-offset-0' : '';

  if (state === 'empty') {
    return `${base} text-slate-600 bg-white/[0.02] border border-white/[0.04]${todayRing}`;
  }
  if (state === 'full') {
    return `${base} text-emerald-50 bg-emerald-500/20 border border-emerald-500/25 shadow-[0_0_18px_rgba(16,185,129,0.10)]${todayRing}`;
  }
  if (state === 'partial') {
    // half-fill effect: subtle gradient + outline
    return `${base} text-slate-200 bg-gradient-to-b from-white/[0.10] to-white/[0.03] border border-emerald-500/20${todayRing}`;
  }
  // none
  return `${base} text-slate-200 bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06]${todayRing}`;
}

function stateForProgress(p?: { transactions: boolean; categories: boolean; biggest_move: boolean }) {
  if (!p) return 'none' as const;
  const n = (p.transactions ? 1 : 0) + (p.categories ? 1 : 0) + (p.biggest_move ? 1 : 0);
  if (n === 3) return 'full' as const;
  if (n === 0) return 'none' as const;
  return 'partial' as const;
}

export default function MonthlyReviewCalendar({
  monthDate,
  onMonthChange,
  progressByDay,
}: {
  monthDate: Date; // any date in the shown month
  onMonthChange: (nextMonthDate: Date) => void;
  progressByDay: ProgressMap;
}) {
  const todayIso = useMemo(() => iso(new Date()), []);
  const mStart = useMemo(() => startOfMonth(monthDate), [monthDate]);
  const mEnd = useMemo(() => endOfMonth(monthDate), [monthDate]);

  // grid starts on Sunday
  const gridStart = useMemo(() => addDays(mStart, -mStart.getDay()), [mStart]);
  const gridEnd = useMemo(() => {
    const e = addDays(mEnd, 6 - mEnd.getDay());
    return e;
  }, [mEnd]);

  const days: Date[] = useMemo(() => {
    const out: Date[] = [];
    for (let d = new Date(gridStart); d <= gridEnd; d = addDays(d, 1)) {
      out.push(new Date(d));
    }
    return out;
  }, [gridStart, gridEnd]);

  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
          Monthly review calendar
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onMonthChange(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1))}
            className="h-8 w-8 rounded-lg border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4 mx-auto" />
          </button>
          <div className="min-w-[150px] text-center text-xs font-semibold text-slate-100">
            {monthLabel(monthDate)}
          </div>
          <button
            type="button"
            onClick={() => onMonthChange(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1))}
            className="h-8 w-8 rounded-lg border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4 mx-auto" />
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-2">
        {dow.map((d) => (
          <div key={d} className="text-[10px] uppercase tracking-wide text-slate-500 text-center">
            {d}
          </div>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-7 gap-2">
        {days.map((d) => {
          const inMonth = d.getMonth() === monthDate.getMonth();
          const key = iso(d);
          const p = progressByDay[key];
          const state = inMonth ? stateForProgress(p) : ('empty' as const);
          const isToday = key === todayIso;
          return (
            <div
              key={key}
              className={dayClass(state, isToday)}
              title={
                inMonth
                  ? `${key} • ${p ? `${(p.transactions ? 1 : 0) + (p.categories ? 1 : 0) + (p.biggest_move ? 1 : 0)}/3 complete` : '0/3 complete'}`
                  : ''
              }
            >
              <span className={inMonth ? '' : 'opacity-40'}>{d.getDate()}</span>
              {inMonth && state === 'partial' && (
                <span className="pointer-events-none absolute inset-x-2 bottom-1 h-[2px] rounded-full bg-emerald-400/40" />
              )}
              {inMonth && state === 'full' && (
                <span className="pointer-events-none absolute inset-x-2 bottom-1 h-[2px] rounded-full bg-emerald-400/80" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


