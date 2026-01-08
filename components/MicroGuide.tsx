'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, X } from 'lucide-react';

type Step = {
  id: string;
  pathnamePrefix: string;
  selector: string;
  message: string; // one short sentence
};

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function getRectForSelector(selector: string): DOMRect | null {
  try {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y) || r.width <= 0 || r.height <= 0) return null;
    return r;
  } catch {
    return null;
  }
}

export function MicroGuide({
  enabled,
  userId,
  pathname,
  onDone,
}: {
  enabled: boolean;
  userId: string;
  pathname: string;
  onDone: () => void;
}) {
  const steps: Step[] = useMemo(
    () => [
      {
        id: 'dashboard',
        pathnamePrefix: '/dashboard',
        selector: '[data-tour="nav-dashboard"]',
        message: 'This dashboard gives you a quick “what’s going on” snapshot.',
      },
      {
        id: 'transactions',
        pathnamePrefix: '/transactions',
        selector: '[data-tour="nav-transactions"]',
        message: 'Transactions is where money flows in and out—keep it tidy here.',
      },
      {
        id: 'alerts',
        pathnamePrefix: '/ai-advisor',
        selector: '[data-tour="nav-alerts"]',
        message: 'Alerts help you catch problems early—before they become stressful.',
      },
      {
        id: 'reports',
        pathnamePrefix: '/reports',
        selector: '[data-tour="nav-reports"]',
        message: 'Reports are for deeper answers when you need them.',
      },
    ],
    []
  );

  const keyDone = `revguard:onboarding:micro_guide_v1:${userId}`;
  const keyStep = `revguard:onboarding:micro_guide_step_v1:${userId}`;

  const [open, setOpen] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  // Load state when enabled.
  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      return;
    }
    try {
      if (localStorage.getItem(keyDone) === '1') {
        setOpen(false);
        return;
      }
      const raw = Number(localStorage.getItem(keyStep) ?? 0);
      const idx = Number.isFinite(raw) ? clamp(raw, 0, steps.length - 1) : 0;
      setStepIdx(idx);
      setOpen(true);
    } catch {
      setStepIdx(0);
      setOpen(true);
    }
  }, [enabled, keyDone, keyStep, steps.length]);

  const activeStep = steps[clamp(stepIdx, 0, steps.length - 1)];
  const onMatchingRoute = Boolean(activeStep && pathname.startsWith(activeStep.pathnamePrefix));

  // Track target element position (non-blocking spotlight).
  useEffect(() => {
    if (!open || !enabled) return;
    if (!onMatchingRoute) {
      setTargetRect(null);
      return;
    }

    const update = () => {
      setTargetRect(getRectForSelector(activeStep.selector));
    };

    update();

    const onScroll = () => update();
    const onResize = () => update();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);

    try {
      roRef.current?.disconnect?.();
      const ro = new ResizeObserver(() => update());
      roRef.current = ro;
      const el = document.querySelector(activeStep.selector) as HTMLElement | null;
      if (el) ro.observe(el);
    } catch {
      // ignore
    }

    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      try {
        roRef.current?.disconnect?.();
      } catch {
        // ignore
      }
    };
  }, [open, enabled, onMatchingRoute, activeStep]);

  function persistStep(next: number) {
    try {
      localStorage.setItem(keyStep, String(next));
    } catch {
      // ignore
    }
  }

  function markDone() {
    try {
      localStorage.setItem(keyDone, '1');
    } catch {
      // ignore
    }
    setOpen(false);
    onDone();
  }

  if (!enabled || !open) return null;
  if (!onMatchingRoute) return null;

  // Spotlight geometry
  const r = targetRect;
  const pad = 10;
  const cx = r ? r.left + r.width / 2 : window.innerWidth * 0.25;
  const cy = r ? r.top + r.height / 2 : 100;
  const radius = r ? Math.max(44, Math.max(r.width, r.height) / 2 + pad) : 64;

  // Tooltip placement
  const tooltipW = 320;
  const tooltipX = clamp(cx - tooltipW / 2, 12, window.innerWidth - tooltipW - 12);
  const tooltipY = clamp((r ? r.bottom + 12 : cy + 12), 12, window.innerHeight - 140);

  return (
    <div className="fixed inset-0 z-[105] pointer-events-none">
      {/* Spotlight layer (non-blocking) */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(circle at ${cx}px ${cy}px, rgba(0,0,0,0) 0px, rgba(0,0,0,0) ${radius}px, rgba(0,0,0,0.55) ${radius + 8}px)`,
        }}
      />

      {/* Tooltip */}
      <div
        className="absolute pointer-events-auto"
        style={{ left: tooltipX, top: tooltipY, width: tooltipW }}
      >
        <div className="rounded-2xl border border-slate-800 bg-slate-950/95 backdrop-blur shadow-[0_18px_60px_rgba(0,0,0,0.45)] overflow-hidden">
          <div className="px-4 py-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                Quick guide
              </div>
              <div className="mt-1 text-sm text-slate-200 leading-relaxed">
                {activeStep.message}
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                Step {stepIdx + 1} of {steps.length}
              </div>
            </div>
            <button
              type="button"
              onClick={markDone}
              className="rounded-xl border border-slate-800 bg-slate-950/40 p-2 text-slate-200 hover:bg-slate-900/70"
              aria-label="Skip guide"
              title="Skip"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-4 pb-4 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => markDone()}
              className="text-xs font-semibold text-slate-300 hover:text-slate-100"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={() => {
                const next = stepIdx + 1;
                if (next >= steps.length) {
                  markDone();
                  return;
                }
                setStepIdx(next);
                persistStep(next);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
            >
              Next <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


