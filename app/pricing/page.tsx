'use client';

import React from 'react';
import { StartProButton } from '../../components/StartProButton';

export default function PricingPage() {
  return (
    <main className="space-y-10 py-2">
        <header className="space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-50">
            Pricing
          </h1>
          <p className="text-slate-300 text-sm md:text-base leading-relaxed max-w-2xl">
            <span className="text-slate-100 font-semibold">
              Everything included. One price.
            </span>{' '}
            Simple monthly billing for growing businesses.
          </p>
        </header>

        <section className="w-full max-w-[980px] mx-auto">
          <div className="rounded-3xl border border-slate-800/80 bg-slate-950/45 backdrop-blur-sm shadow-[0_30px_90px_rgba(0,0,0,0.35)] overflow-hidden">
            <div className="p-7 md:p-10">
              <div className="grid md:grid-cols-3 gap-8 md:gap-10 items-start">
                {/* Left: plan + included */}
                <div className="md:col-span-2">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                    Single plan
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <div className="text-2xl font-semibold text-slate-100">
                      RevGuard Pro
                    </div>
                    <div className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-200">
                      Everything included
                    </div>
                  </div>

                  <div className="mt-3 text-sm md:text-base text-slate-300 leading-relaxed">
                    First 2 months{' '}
                    <span className="font-semibold text-slate-100">$69/mo</span>,
                    then auto‑renews at{' '}
                    <span className="font-semibold text-slate-100">$99/mo</span>.
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500">
                    Prices in USD • billed monthly • 1 business per account
                  </div>

                  <div className="mt-8">
                    <div className="text-xs font-semibold text-slate-200">
                      What’s included
                    </div>
                    <ul className="mt-4 grid md:grid-cols-2 gap-x-10 gap-y-4 text-sm text-slate-200 leading-relaxed">
                      {[
                        'AI-powered financial clarity — know exactly where your money is going',
                        'Real-time cash flow & profit tracking',
                        'Customer-level revenue insights',
                        'Tax-aware reporting with estimated taxes owed',
                        'Clean, CPA-ready reports (PDF)',
                        'One business, everything included — no add-ons',
                      ].map((t) => (
                        <li key={t} className="flex items-start gap-3">
                          <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-300 text-[11px] border border-emerald-500/20">
                            ✓
                          </span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Right: price + CTA */}
                <div className="md:col-span-1">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-5 md:p-6 shadow-[0_0_0_1px_rgba(148,163,184,0.06)]">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                      RevGuard Pro
                    </div>
                    <div className="mt-2 text-4xl font-semibold text-emerald-300 tracking-tight">
                      $99
                      <span className="ml-1 text-sm font-medium text-slate-500">
                        /month
                      </span>
                    </div>
                    <div className="mt-2 text-[11px] text-slate-400 leading-relaxed">
                      Includes a 2‑month intro offer at $69/month.
                    </div>
                    <div className="mt-5">
                      <StartProButton className="w-full px-4 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-semibold hover:bg-emerald-400 transition" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
    </main>
  );
}


