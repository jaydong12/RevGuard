'use client';

import React from 'react';

export default function BookingsPage() {
  return (
    <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
          Bookings
        </h1>
        <p className="text-slate-400 text-sm">
          Calendar + auto-invoices
        </p>
      </header>

      <section className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-6 shadow-[0_1px_0_rgba(255,255,255,0.04)]">
        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
          Coming soon
        </div>
        <div className="mt-2 text-lg font-semibold text-slate-50 tracking-tight">
          No bookings yet
        </div>
        <div className="mt-1 text-sm text-slate-300 leading-relaxed">
          This is where your booking calendar and automated invoice flow will live.
        </div>
      </section>
    </main>
  );
}


