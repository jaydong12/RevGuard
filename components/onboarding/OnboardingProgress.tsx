"use client";

import React from 'react';

const steps = [
  { key: 'business', label: 'Business' },
  { key: 'profile', label: 'Profile' },
  { key: 'banking', label: 'Banking' },
] as const;

export function OnboardingProgress({ step }: { step: 'business' | 'profile' | 'banking' | 'done' }) {
  const idx = step === 'done' ? steps.length - 1 : Math.max(0, steps.findIndex((s) => s.key === step));
  const current = idx + 1;
  const total = 3;
  const pct = step === 'done' ? 100 : Math.round((current / total) * 100);

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between text-[11px] text-slate-400">
        <div>
          Step <span className="text-slate-200">{current}</span> of <span className="text-slate-200">{total}</span>
        </div>
        <div className="text-slate-500">{steps[idx]?.label ?? ''}</div>
      </div>
      <div className="mt-2 h-2 w-full rounded-full bg-white/5 overflow-hidden border border-white/10">
        <div
          className="h-full rounded-full bg-emerald-500 transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}


