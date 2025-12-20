'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  BookOpenCheck,
  Check,
  ChevronRight,
  Lock,
  Menu,
  ShieldCheck,
  Sparkles,
  Timer,
  Wand2,
  X,
} from 'lucide-react';

export default function LandingPage() {
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav = [
    { label: 'Features', href: '#features' },
    { label: 'How it works', href: '#how' },
    { label: 'Security', href: '#security' },
    { label: 'Pricing', href: '#pricing' },
    { label: 'FAQ', href: '#faq' },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 scroll-smooth">
      {/* Subtle background gradient */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-24 left-1/2 h-[520px] w-[980px] -translate-x-1/2 rounded-full bg-gradient-to-r from-emerald-500/20 via-sky-500/15 to-blue-500/20 blur-3xl" />
        <div className="absolute bottom-[-240px] right-[-200px] h-[520px] w-[520px] rounded-full bg-emerald-500/10 blur-3xl" />
      </div>

      {/* Navbar */}
      <header className="sticky top-0 z-50 border-b border-slate-800/70 bg-slate-950/70 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Image
              src="/revguard-r.svg"
              alt="RevGuard"
              width={32}
              height={32}
              className="h-8 w-8"
              priority
            />
            <div className="font-semibold tracking-tight">RevGuard</div>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm text-slate-300">
            {nav.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className="hover:text-slate-50 transition-colors"
              >
                {n.label}
              </a>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900/70"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
            >
              Sign up
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="md:hidden rounded-xl border border-slate-800 bg-slate-950/40 p-2 text-slate-200 hover:bg-slate-900/70"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Mobile menu */}
        <div
          className={`md:hidden overflow-hidden border-t border-slate-800/70 transition-all duration-200 ${
            mobileOpen ? 'max-h-80 opacity-100' : 'max-h-0 opacity-0'
          }`}
        >
          <div className="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-3">
            <div className="flex flex-col gap-2 text-sm text-slate-300">
              {nav.map((n) => (
                <a
                  key={n.href}
                  href={n.href}
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 hover:bg-slate-900/70"
                >
                  <span>{n.label}</span>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </a>
              ))}
            </div>
            <div className="flex gap-2">
              <Link
                href="/login"
                className="flex-1 rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900/70"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="flex-1 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
              >
                Sign up
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 pt-14 pb-10">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-200">
              <Sparkles className="h-4 w-4" />
              AI Accounting for modern operators
            </div>

            <h1 className="mt-5 text-4xl font-semibold tracking-tight leading-[1.08]">
              Close your books faster. Catch revenue leaks early.
              <span className="text-emerald-300"> Stay audit-ready.</span>
            </h1>
            <p className="mt-4 text-base text-slate-300 leading-relaxed">
              RevGuard is a premium, AI-assisted accounting dashboard that turns messy
              transactions into clean reporting—so you always know what changed, why,
              and what to do next.
            </p>

            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
              >
                Start free <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/40 px-5 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-900/70"
              >
                Log in <ChevronRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3 text-xs text-slate-300">
              <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-3">
                <Timer className="h-4 w-4 text-emerald-300" />
                <span>Fast, daily insights</span>
              </div>
              <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-3">
                <BarChart3 className="h-4 w-4 text-sky-300" />
                <span>Clean reporting</span>
              </div>
              <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-3">
                <ShieldCheck className="h-4 w-4 text-blue-300" />
                <span>Security-first</span>
              </div>
            </div>
          </div>

          {/* Mock */}
          <div className="relative">
            <div className="rounded-3xl border border-slate-800 bg-slate-950/60 shadow-xl shadow-emerald-500/10 overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-800/70 px-5 py-4">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
                  <div className="h-2.5 w-2.5 rounded-full bg-amber-300/80" />
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-300/80" />
                </div>
                <div className="text-xs text-slate-400">RevGuard</div>
                <div className="h-6 w-20 rounded-full bg-slate-900/70 border border-slate-800" />
              </div>

              <div className="p-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  {[
                    { label: 'Net cashflow', value: '+$12,480', tone: 'text-emerald-300' },
                    { label: 'Expenses', value: '$8,230', tone: 'text-rose-300' },
                    { label: 'Revenue', value: '$20,710', tone: 'text-sky-300' },
                  ].map((c) => (
                    <div
                      key={c.label}
                      className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
                    >
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        {c.label}
                      </div>
                      <div className={`mt-2 text-lg font-semibold ${c.tone}`}>
                        {c.value}
                      </div>
                      <div className="mt-3 h-2 rounded-full bg-slate-900 border border-slate-800 overflow-hidden">
                        <div className="h-full w-2/3 bg-gradient-to-r from-emerald-400/60 via-sky-400/60 to-blue-400/60" />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-slate-100 flex items-center gap-2">
                        <Wand2 className="h-4 w-4 text-emerald-300" />
                        AI Insights
                      </div>
                      <div className="mt-1 text-[11px] text-slate-400">
                        Clear drivers. Next actions. No fluff.
                      </div>
                    </div>
                    <div className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-200">
                      <BadgeCheck className="h-4 w-4" />
                      Ready
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2">
                    {[
                      'Refunds spiked → review top SKUs.',
                      'Payroll up MoM → validate changes.',
                      'Revenue concentrated → diversify clients.',
                    ].map((t) => (
                      <div
                        key={t}
                        className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-[11px] text-slate-300"
                      >
                        <Check className="h-4 w-4 text-emerald-300" />
                        <span className="truncate">{t}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[32px] bg-gradient-to-br from-emerald-500/15 via-sky-500/10 to-blue-500/15 blur-2xl" />
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-6xl mx-auto px-4 py-14">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Features</h2>
          <p className="mt-2 text-sm text-slate-400">
            Everything you need for clean numbers, fast decisions, and confident reporting.
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              icon: <BarChart3 className="h-5 w-5 text-sky-300" />,
              title: 'Live dashboard',
              desc: 'Cashflow, profitability, and trend views that update as your data changes.',
            },
            {
              icon: <Sparkles className="h-5 w-5 text-emerald-300" />,
              title: 'AI insights',
              desc: 'What changed, top drivers, next actions, and follow-ups—written clearly.',
            },
            {
              icon: <BookOpenCheck className="h-5 w-5 text-amber-300" />,
              title: 'Statements & reports',
              desc: 'Income statement, balance sheet, cashflow, and premium reporting views.',
            },
            {
              icon: <Timer className="h-5 w-5 text-emerald-300" />,
              title: 'Faster close',
              desc: 'Spend less time reconciling and more time acting on what matters.',
            },
            {
              icon: <ShieldCheck className="h-5 w-5 text-blue-300" />,
              title: 'Security-first',
              desc: 'RLS-protected data model and server-side account deletion for safety.',
            },
            {
              icon: <Lock className="h-5 w-5 text-slate-200" />,
              title: 'Audit-ready',
              desc: 'Clear data boundaries per business, with cascade deletes and ownership checks.',
            },
          ].map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5 shadow-sm hover:shadow-emerald-500/10 transition"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/60">
                  {f.icon}
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-100">{f.title}</div>
                  <div className="mt-1 text-sm text-slate-400">{f.desc}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="max-w-6xl mx-auto px-4 py-14">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
          <p className="mt-2 text-sm text-slate-400">
            Three steps to go from “messy ledger” to “clear actions.”
          </p>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {[
            {
              n: '01',
              title: 'Connect & import',
              desc: 'Bring in transactions and keep your data organized by business.',
            },
            {
              n: '02',
              title: 'Categorize & review',
              desc: 'Clean categories and spot anomalies with premium summaries.',
            },
            {
              n: '03',
              title: 'Get insights',
              desc: 'Ask RevGuard “what changed” and get next actions you can execute today.',
            },
          ].map((s) => (
            <div
              key={s.n}
              className="rounded-3xl border border-slate-800 bg-slate-950/60 p-6"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                  {s.n}
                </div>
                <div className="text-sm font-semibold text-slate-100">{s.title}</div>
              </div>
              <p className="mt-3 text-sm text-slate-400 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Security */}
      <section id="security" className="max-w-6xl mx-auto px-4 py-14">
        <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-950/70 via-slate-950/40 to-emerald-950/30 p-7">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Security</h2>
              <p className="mt-2 text-sm text-slate-400">
                Built with least-privilege defaults and ownership checks.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-xs text-slate-200">
              <ShieldCheck className="h-4 w-4 text-emerald-300" />
              RLS + server-side deletion
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            {[
              {
                title: 'Row Level Security',
                desc: 'User data is isolated with RLS and business ownership checks.',
              },
              {
                title: 'Server-side account deletion',
                desc: 'Deletion is verified via session and executed using service role on the server.',
              },
              {
                title: 'Cascade deletes',
                desc: 'Foreign keys cascade from auth user → business → child data.',
              },
            ].map((it) => (
              <div key={it.title} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
                <div className="text-sm font-semibold text-slate-100">{it.title}</div>
                <div className="mt-2 text-sm text-slate-400">{it.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-6xl mx-auto px-4 py-14">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Pricing</h2>
            <p className="mt-2 text-sm text-slate-400">
              One plan. All features included.
            </p>
          </div>
          <div className="text-xs text-slate-400">Cancel anytime • No surprises</div>
        </div>

        <div className="mt-8">
          <div className="mx-auto w-full max-w-lg rounded-3xl border border-emerald-500/40 bg-emerald-500/10 p-6 shadow-lg shadow-emerald-500/15">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">RevGuard Pro</div>
                <div className="mt-1 text-[11px] text-slate-400">All features included</div>
              </div>
              <div className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-200">
                <BadgeCheck className="h-4 w-4" />
                Most popular
              </div>
            </div>

            <div className="mt-5">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                Intro promo (first 2 months)
              </div>
              <div className="mt-2 flex items-end gap-3">
                <div className="text-4xl font-semibold tracking-tight text-emerald-200">
                  $69
                  <span className="ml-1 text-sm font-medium text-slate-400">/mo</span>
                </div>
                <div className="pb-1 text-sm text-slate-400">
                  <span className="line-through">$99/mo</span>
                </div>
              </div>
              <div className="mt-2 text-sm text-slate-300">
                Then <span className="font-semibold text-slate-100">$99/mo</span>. Cancel anytime.
              </div>
              <div className="mt-2 text-xs text-slate-300">
                Save <span className="font-semibold text-emerald-200">$60</span> in your first 2 months.
              </div>
            </div>

            <div className="mt-5 space-y-2 text-sm text-slate-300">
              {[
                'AI insights + premium reports',
                'Cash overview, statements, and exports',
                'Business-scoped data + audit-ready controls',
              ].map((f) => (
                <div key={f} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 text-emerald-300" />
                  <span>{f}</span>
                </div>
              ))}
            </div>

            <div className="mt-6">
              <Link
                href="/signup"
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
              >
                Start now — save $60 <ChevronRight className="h-4 w-4" />
              </Link>
              <div className="mt-2 text-[11px] text-slate-400">
                Start at $69/mo for 2 months • then $99/mo
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="max-w-6xl mx-auto px-4 py-14">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">FAQ</h2>
          <p className="mt-2 text-sm text-slate-400">
            Quick answers to common questions.
          </p>
        </div>

        <div className="mt-8 grid gap-3">
          {[
            {
              q: 'Do I need an accountant to use RevGuard?',
              a: 'No—RevGuard is designed to be usable by founders and operators. If you work with an accountant, RevGuard helps you hand them cleaner data.',
            },
            {
              q: 'Is my data isolated per business?',
              a: 'Yes. Tables are business-scoped and enforced with ownership checks + RLS policies.',
            },
            {
              q: 'Can I delete my account and data?',
              a: 'Yes. Account deletion is server-side using a Supabase service role, and data is removed via cascade foreign keys.',
            },
          ].map((item) => (
            <details
              key={item.q}
              className="group rounded-2xl border border-slate-800 bg-slate-950/60 p-5"
            >
              <summary className="cursor-pointer list-none select-none flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-100">{item.q}</span>
                <ChevronRight className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-90" />
              </summary>
              <p className="mt-3 text-sm text-slate-400 leading-relaxed">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-6xl mx-auto px-4 pb-16">
        <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-emerald-500/15 via-slate-950/40 to-blue-500/10 p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-2xl font-semibold tracking-tight">
                Ready to run your numbers with confidence?
              </h3>
              <p className="mt-2 text-sm text-slate-300">
                Create your account and get a premium dashboard in minutes.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
              >
                Sign up <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/40 px-5 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-900/70"
              >
                Log in <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}


