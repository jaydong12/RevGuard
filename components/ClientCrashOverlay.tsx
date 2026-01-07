'use client';

import React, { useEffect, useMemo, useState } from 'react';

type Crash = {
  message: string;
  stack?: string;
  source?: string;
};

function toCrash(e: unknown): Crash {
  try {
    if (e instanceof Error) {
      return { message: e.message || 'Unknown error', stack: e.stack || undefined };
    }
    if (typeof e === 'string') return { message: e };
    return { message: String((e as any)?.message ?? e ?? 'Unknown error') };
  } catch {
    return { message: 'Unknown error' };
  }
}

export function ClientCrashOverlay() {
  const [crash, setCrash] = useState<Crash | null>(null);

  useEffect(() => {
    function onError(ev: ErrorEvent) {
      setCrash((prev) => {
        if (prev) return prev;
        const err = (ev as any)?.error;
        const c = toCrash(err ?? ev?.message ?? 'Unknown error');
        return { ...c, source: ev?.filename ? `${ev.filename}:${ev.lineno ?? ''}:${ev.colno ?? ''}` : c.source };
      });
    }

    function onRejection(ev: PromiseRejectionEvent) {
      setCrash((prev) => {
        if (prev) return prev;
        return { ...toCrash(ev?.reason), source: 'unhandledrejection' };
      });
    }

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  const details = useMemo(() => {
    if (!crash) return '';
    const parts = [
      `MESSAGE: ${crash.message}`,
      crash.source ? `SOURCE: ${crash.source}` : null,
      crash.stack ? `STACK:\n${crash.stack}` : null,
    ].filter(Boolean);
    return parts.join('\n\n');
  }, [crash]);

  if (!crash) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-[9999] mx-auto max-w-4xl">
      <div className="rounded-2xl border border-rose-500/40 bg-rose-950/40 backdrop-blur px-4 py-3 shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-200/90">
              Client crash captured
            </div>
            <div className="mt-1 text-sm text-rose-100 break-words">
              {crash.message}
            </div>
            {crash.source ? (
              <div className="mt-1 text-[11px] text-rose-200/70 break-words">
                {crash.source}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(details || crash.message);
                } catch {
                  // ignore
                }
              }}
              className="rounded-xl bg-rose-500 px-3 py-2 text-[11px] font-semibold text-slate-950 hover:bg-rose-400"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => setCrash(null)}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-semibold text-slate-100 hover:bg-white/10"
            >
              Dismiss
            </button>
          </div>
        </div>
        {crash.stack ? (
          <pre className="mt-3 max-h-[220px] overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 text-[10px] leading-relaxed text-rose-100/90 whitespace-pre-wrap break-words">
            {crash.stack}
          </pre>
        ) : null}
      </div>
    </div>
  );
}


