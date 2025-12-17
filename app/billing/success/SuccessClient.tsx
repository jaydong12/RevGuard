'use client';

import React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

export default function BillingSuccessClient() {
  const params = useSearchParams();
  const sessionId = params.get('session_id');

  return (
    <main className="max-w-2xl mx-auto">
      <div className="rounded-3xl border border-slate-800/80 bg-slate-950/45 backdrop-blur-sm shadow-[0_30px_90px_rgba(0,0,0,0.35)] overflow-hidden">
        <div className="p-7 md:p-10">
          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
            Billing
          </div>
          <h1 className="mt-2 text-2xl md:text-3xl font-bold tracking-tight text-slate-50">
            You’re all set
          </h1>
          <p className="mt-2 text-sm md:text-base text-slate-300 leading-relaxed">
            Your checkout completed successfully. You can head back to the app.
          </p>
          {sessionId ? (
            <div className="mt-4 text-[11px] text-slate-500">
              Session: <span className="text-slate-300">{sessionId}</span>
            </div>
          ) : null}

          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition"
            >
              Go to dashboard
            </Link>
            <Link
              href="/transactions"
              className="inline-flex items-center justify-center rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-900/70 transition"
            >
              View transactions
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}


