'use client';

import React from 'react';

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

export function ReportLayout({
  chartTitle = 'Trend',
  chartSubtitle,
  chart,
  detailsTitle = 'Details / Breakdown',
  detailsRight,
  details,
  printDetails,
  detailsOpen,
  onToggleDetails,
}: {
  chartTitle?: string;
  chartSubtitle?: string;
  chart: React.ReactNode;
  detailsTitle?: string;
  detailsRight?: React.ReactNode;
  details?: React.ReactNode;
  /** Rendered in print even when Details is collapsed (tables print reliably vs charts). */
  printDetails?: React.ReactNode;
  detailsOpen: boolean;
  onToggleDetails: () => void;
}) {
  const hasDetails = Boolean(details) || Boolean(printDetails);

  return (
    <div className="space-y-6 md:space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5 md:p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold text-slate-200">{chartTitle}</div>
          <div className="text-[11px] text-slate-500">{chartSubtitle}</div>
        </div>
        {chart}
      </div>

      {hasDetails && (
        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 overflow-hidden">
          <div className="no-print px-5 py-4 md:px-4 md:py-3 border-b border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="text-xs font-semibold text-slate-200">{detailsTitle}</div>
              {detailsRight}
            </div>
            <button
              type="button"
              onClick={onToggleDetails}
              className={classNames(
                'rounded-xl border px-3 py-1.5 text-[11px] transition',
                detailsOpen
                  ? 'border-slate-700 bg-slate-900/60 text-slate-100 hover:bg-slate-900/80'
                  : 'border-slate-800 bg-slate-950/40 text-slate-200 hover:bg-slate-900/70'
              )}
            >
              {detailsOpen ? 'Hide' : 'Show'}
            </button>
          </div>

          {/* Print-only details are always shown when printing. */}
          {printDetails && <div className="print-only px-5 py-4 md:px-4 md:py-3">{printDetails}</div>}

          {detailsOpen && details && <div className="no-print">{details}</div>}
        </div>
      )}
    </div>
  );
}


