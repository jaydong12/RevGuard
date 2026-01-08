'use client';

import React from 'react';
import type { PlanId } from '../lib/plans';

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

export function UpgradeModal({
  open,
  requiredPlan,
  currentPlan,
  onClose,
  onConfirm,
  reason,
}: {
  open: boolean;
  requiredPlan: Exclude<PlanId, 'none'>;
  currentPlan: PlanId;
  onClose: () => void;
  onConfirm: () => void;
  reason?: string | null;
}) {
  if (!open) return null;

  const label =
    requiredPlan === 'starter'
      ? 'Starter'
      : requiredPlan === 'growth'
        ? 'Growth'
        : 'Pro';

  return (
    <div className="fixed inset-0 z-[120]">
      <button
        type="button"
        aria-label="Close upgrade modal"
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
      />

      <div className="absolute inset-x-0 top-16 md:top-24 mx-auto w-[92vw] max-w-lg">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/90 backdrop-blur shadow-[0_30px_90px_rgba(0,0,0,0.55)] overflow-hidden">
          <div className="p-5 md:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                  Upgrade required
                </div>
                <div className="mt-2 text-lg font-semibold text-slate-100">
                  Unlock {label}
                </div>
                <div className="mt-1 text-sm text-slate-300 leading-relaxed">
                  {reason || (
                    <>
                      This feature requires the <span className="font-semibold text-slate-100">{label}</span> plan.
                    </>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-200 hover:bg-slate-900/70"
              >
                Close
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-100">{label}</div>
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                Current plan: <span className="text-slate-200">{currentPlan === 'none' ? 'No active plan' : currentPlan}</span>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-900/70"
              >
                Not now
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={classNames(
                  'rounded-xl px-4 py-2.5 text-xs font-semibold transition',
                  'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                )}
              >
                View plans
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


