'use client';

import React from 'react';
import Link from 'next/link';

export default function BillingCancelPage() {
  return (
    <main className="max-w-2xl mx-auto">
      <div className="rounded-3xl border border-slate-800/80 bg-slate-950/45 backdrop-blur-sm shadow-[0_30px_90px_rgba(0,0,0,0.35)] overflow-hidden">
        <div className="p-7 md:p-10">
          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
            Billing
          </div>
          <h1 className="mt-2 text-2xl md:text-3xl font-bold tracking-tight text-slate-50">
            Checkout canceled
          </h1>
          <p className="mt-2 text-sm md:text-base text-slate-300 leading-relaxed">
            No worries — you weren’t charged. You can restart checkout any time from Pricing.
          </p>
          <div className="mt-6">
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
            >
              Back to pricing
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}


