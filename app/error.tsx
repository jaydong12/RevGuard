'use client';

import React, { useEffect } from 'react';

export default function GlobalErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    try {
      // eslint-disable-next-line no-console
      console.error('APP_ERROR_BOUNDARY', error?.message ?? String(error), error?.stack ?? '');
    } catch {
      // ignore
    }
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="rounded-2xl border border-rose-500/40 bg-rose-950/20 p-5">
          <div className="text-sm font-semibold text-rose-100">Something went wrong</div>
          <div className="mt-2 text-sm text-rose-200/90 leading-relaxed">
            {String(error?.message ?? 'Unknown error')}
          </div>
          {error?.digest ? (
            <div className="mt-3 text-xs text-rose-200/70">Digest: {String(error.digest)}</div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => reset()}
              className="rounded-xl bg-rose-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-rose-400"
            >
              Try again
            </button>
            <a
              href="/"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
            >
              Go home
            </a>
          </div>
          <div className="mt-4 text-xs text-slate-400">
            Open DevTools → Console and copy the first error above for the fastest fix.
          </div>
        </div>
      </div>
    </div>
  );
}


