'use client';

import React, { useEffect, useMemo, useState } from 'react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line no-console
      console.error('DASHBOARD_ERROR_BOUNDARY', error?.message ?? String(error), error?.stack ?? '');
    } catch {
      // ignore
    }
  }, [error]);

  const details = useMemo(() => {
    const parts = [
      `MESSAGE: ${String(error?.message ?? 'Unknown error')}`,
      error?.digest ? `DIGEST: ${String(error.digest)}` : null,
      error?.stack ? `STACK:\n${String(error.stack)}` : null,
    ].filter(Boolean);
    return parts.join('\n\n');
  }, [error]);

  return (
    <div className="min-h-[60vh] rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-slate-50">
      <div className="text-xs uppercase tracking-[0.18em] text-rose-200/80">
        Dashboard crashed
      </div>
      <div className="mt-2 text-lg font-semibold text-rose-100">
        {String(error?.message ?? 'Unknown error')}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-xl bg-rose-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-rose-400"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(details || String(error?.message ?? 'Unknown error'));
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            } catch {
              // ignore
            }
          }}
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-100 hover:bg-white/10"
        >
          {copied ? 'Copied' : 'Copy stack'}
        </button>
      </div>

      <pre className="mt-4 max-h-[320px] overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 text-[11px] leading-relaxed text-rose-100/90 whitespace-pre-wrap break-words">
        {details}
      </pre>
    </div>
  );
}


