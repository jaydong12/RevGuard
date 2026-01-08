'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, Check, ChevronRight, Menu, X } from 'lucide-react';
import type { PlanId } from '../lib/plans';
import { PLAN_META } from '../lib/plans';
import { getSupabaseClient } from '../utils/supabaseClient';

type PlanState = {
  checked: boolean;
  currentPlan: PlanId;
};

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

function normalizePlanFromBusinessRow(row: any): PlanId {
  const status = String(row?.subscription_status ?? 'inactive').trim().toLowerCase();
  const rawPlan = String(row?.subscription_plan ?? '').trim().toLowerCase();
  if (status !== 'active') return 'none';
  if (rawPlan === 'starter') return 'starter';
  if (rawPlan === 'growth') return 'growth';
  if (rawPlan === 'pro') return 'pro';
  // Legacy: active with no plan column means old single-plan (Pro).
  return 'pro';
}

export default function LandingPage() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const supabase = getSupabaseClient();

  const [plan, setPlan] = useState<PlanState>({ checked: false, currentPlan: 'none' });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (!supabase) {
          if (!cancelled) setPlan({ checked: true, currentPlan: 'none' });
      return;
    }

        const { data } = await supabase.auth.getSession();
        const session = data.session ?? null;
        const userId = session?.user?.id ?? null;
        const email = String(session?.user?.email ?? '').trim().toLowerCase();
        const isAdmin = email === 'jaydongant@gmail.com' || email === 'shannon_g75@yahoo.com';

    if (!userId) {
          if (!cancelled) setPlan({ checked: true, currentPlan: 'none' });
      return;
    }
        if (isAdmin) {
          if (!cancelled) setPlan({ checked: true, currentPlan: 'pro' });
      return;
    }

        // subscription_plan may not exist in older DBs; fallback if needed.
        const firstTry = await supabase
          .from('business')
          .select('id, subscription_status, subscription_plan')
          .eq('owner_id', userId)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (firstTry.error) {
          const msg = String((firstTry.error as any)?.message ?? '');
          const code = String((firstTry.error as any)?.code ?? '');
          const missingCol =
            code === '42703' || /column .*subscription_plan.* does not exist/i.test(msg);

          if (missingCol) {
            const fallback = await supabase
              .from('business')
              .select('id, subscription_status')
              .eq('owner_id', userId)
              .order('created_at', { ascending: true })
              .limit(1)
              .maybeSingle();

            if (!cancelled) {
              setPlan({
                checked: true,
                currentPlan: normalizePlanFromBusinessRow(fallback.data),
              });
            }
        return;
      }

          if (!cancelled) setPlan({ checked: true, currentPlan: 'none' });
          return;
        }

        if (!cancelled) {
          setPlan({ checked: true, currentPlan: normalizePlanFromBusinessRow(firstTry.data) });
        }
      } catch {
        if (!cancelled) setPlan({ checked: true, currentPlan: 'none' });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const primaryCta = useMemo(() => {
    const starterPromo = PLAN_META.starter.promoFirstMonth;
    if (plan.checked && plan.currentPlan !== 'none') {
      return { href: '/dashboard', label: 'Go to dashboard' };
    }
    return { href: '/pricing?upgrade=starter', label: `Start for $${starterPromo} (first month)` };
  }, [plan.checked, plan.currentPlan]);

  const nav = [
    { label: 'Problems', href: '#problems' },
    { label: 'How it helps', href: '#levels' },
    { label: 'Plans', href: '#plans' },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 scroll-smooth antialiased">
      {/* Subtle background gradient */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-24 left-1/2 h-[520px] w-[980px] -translate-x-1/2 rounded-full bg-gradient-to-r from-emerald-500/18 via-sky-500/14 to-blue-500/18 blur-3xl" />
        <div className="absolute top-[320px] left-[-220px] h-[520px] w-[520px] rounded-full bg-sky-500/10 blur-3xl" />
        <div className="absolute bottom-[-240px] right-[-200px] h-[520px] w-[520px] rounded-full bg-emerald-500/10 blur-3xl" />
      </div>

      {/* Navbar */}
      <header className="sticky top-0 z-50 border-b border-slate-800/70 bg-slate-950/70 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Image
              src="/logo.png"
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
              <a key={n.href} href={n.href} className="hover:text-slate-50 transition-colors">
                {n.label}
              </a>
            ))}
            <Link href="/pricing" className="hover:text-slate-50 transition-colors">
              Pricing
            </Link>
          </nav>

          <div className="hidden md:flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900/70"
            >
              Log in
            </Link>
            <Link
              href={primaryCta.href}
              className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
            >
              {primaryCta.label}
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
          className={classNames(
            'md:hidden overflow-hidden border-t border-slate-800/70 transition-all duration-200',
            mobileOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
          )}
        >
          <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col gap-3">
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
              <Link
                href="/pricing"
                onClick={() => setMobileOpen(false)}
                className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 hover:bg-slate-900/70"
              >
                <span>Pricing</span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </Link>
            </div>
            <div className="flex gap-2">
              <Link
                href="/login"
                className="flex-1 rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900/70"
              >
                Log in
              </Link>
              <Link
                href={primaryCta.href}
                className="flex-1 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 text-center"
              >
                {primaryCta.label}
              </Link>
                  </div>
                </div>
            </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-24 pb-20">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              <div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.12] max-w-2xl">
              Know if your business is healthy — without digging through numbers.
            </h1>
            <p className="mt-6 text-lg text-slate-300 leading-relaxed max-w-xl">
              RevGuard watches your money, flags problems, and keeps you organized as you grow.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <Link
                href={primaryCta.href}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-6 py-3.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 shadow-lg shadow-emerald-500/10"
              >
                {primaryCta.label} <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/40 px-6 py-3.5 text-sm font-semibold text-slate-200 hover:bg-slate-900/70"
              >
                See pricing <ChevronRight className="h-4 w-4" />
              </Link>
                </div>

            <div className="mt-8 grid gap-3 max-w-xl">
              {[
                'Feel in control — even when you’re busy.',
                'Catch issues early instead of reacting late.',
                'Stay organized so money doesn’t slip away.',
              ].map((t) => (
                <div
                  key={t}
                  className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/45 px-4 py-3 text-sm text-slate-200"
                >
                  <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-300 text-[11px] border border-emerald-500/20">
                    ✓
                  </span>
                  <span className="leading-relaxed">{t}</span>
                  </div>
              ))}
              </div>
                    </div>

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
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="text-xs font-semibold text-slate-100">Today</div>
                  <div className="mt-2 grid gap-2">
                    {[
                      { label: 'Cash is trending down', note: 'You spent more than you earned this week.' },
                      { label: 'Two bills are coming up', note: 'So you’re not surprised.' },
                      { label: 'An invoice is overdue', note: 'So you get paid without chasing.' },
                    ].map((r) => (
                      <div
                        key={r.label}
                        className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2"
                      >
                        <div className="text-[11px] font-semibold text-slate-100 flex items-center gap-2">
                          <Check className="h-4 w-4 text-emerald-300" />
                          <span>{r.label}</span>
                      </div>
                        <div className="mt-0.5 text-[11px] text-slate-400 leading-relaxed">
                          {r.note}
                    </div>
                        </div>
                          ))}
                      </div>
                        </div>
                      </div>
                        </div>

            <div className="pointer-events-none absolute -bottom-10 -right-10 h-56 w-56 rounded-full bg-emerald-500/15 blur-3xl" />
            <div className="pointer-events-none absolute -top-10 -left-10 h-56 w-56 rounded-full bg-sky-500/12 blur-3xl" />
                      </div>
                    </div>
      </section>

      {/* Problems */}
      <section id="problems" className="max-w-6xl mx-auto px-6 pb-20">
        <div className="max-w-2xl">
          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">The problem</div>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">
            Running a business is hard enough.
          </h2>
          <p className="mt-3 text-slate-300 leading-relaxed">
            Most owners don’t need more “finance work.” They need clarity and calm.
          </p>
                        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            'Not sure where your money is going',
            'Invoices, bills, and workers slipping through the cracks',
            'You only look at finances when something goes wrong',
          ].map((t) => (
            <div
              key={t}
              className="rounded-3xl border border-slate-800 bg-slate-950/55 p-6 shadow-[0_0_0_1px_rgba(148,163,184,0.06)]"
            >
              <div className="text-sm font-semibold text-slate-100">{t}</div>
              <div className="mt-2 text-sm text-slate-300 leading-relaxed">
                RevGuard helps you stay ahead — with small nudges, not big headaches.
                                </div>
                        </div>
          ))}
          </div>
        </section>

      {/* Levels */}
      <section id="levels" className="max-w-6xl mx-auto px-6 pb-20">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
            <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">The solution</div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">
              RevGuard is simple — and it grows with you.
            </h2>
            <p className="mt-4 text-slate-300 leading-relaxed max-w-xl">
              Start where you are today. Add structure as your business gets busier.
            </p>
          </div>

          <div className="grid gap-4">
            {[
              {
                n: '1',
                title: 'Starter – Stay organized & get paid',
                desc: 'Keep money tidy, keep invoices moving, and stay on top of basics without stress.',
              },
              {
                n: '2',
                title: 'Growth – Run operations without chaos',
                desc: 'Add the tools that prevent slip-ups as you juggle bookings, bills, and a team.',
              },
              {
                n: '3',
                title: 'Pro – AI watches your business for you',
                desc: 'Get proactive warnings and guidance so you don’t have to think about finances daily.',
              },
            ].map((s) => (
              <div key={s.n} className="rounded-3xl border border-slate-800 bg-slate-950/55 p-6">
                <div className="flex items-start gap-4">
                  <div className="h-9 w-9 rounded-2xl bg-emerald-500/12 border border-emerald-500/20 text-emerald-200 flex items-center justify-center text-sm font-semibold">
                    {s.n}
              </div>
                <div>
                    <div className="text-sm font-semibold text-slate-100">{s.title}</div>
                    <div className="mt-1 text-sm text-slate-300 leading-relaxed">{s.desc}</div>
                  </div>
                </div>
                  </div>
            ))}
                </div>
              </div>
      </section>

      {/* Plans preview */}
      <section id="plans" className="max-w-6xl mx-auto px-6 pb-20">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div className="max-w-2xl">
            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Plans preview</div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">Pick your starting point.</h2>
            <p className="mt-3 text-slate-300 leading-relaxed">
              Less stress. More clarity. Upgrade any time.
                  </p>
                </div>
          <Link
            href="/pricing"
            className="text-sm text-slate-300 hover:text-slate-50 inline-flex items-center gap-2"
          >
            See full pricing <ChevronRight className="h-4 w-4" />
          </Link>
              </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3 items-stretch">
          {(['starter', 'growth', 'pro'] as const).map((p) => {
            const meta = PLAN_META[p];
            const isCurrent = plan.checked && plan.currentPlan === p;
            const startHref = plan.checked && plan.currentPlan !== 'none' ? '/dashboard' : `/pricing?upgrade=${p}`;
            return (
              <div
                key={p}
                className="rounded-3xl border border-slate-800 bg-slate-950/55 p-6 shadow-[0_0_0_1px_rgba(148,163,184,0.06)] flex flex-col"
              >
                <div className="flex items-start justify-between gap-3">
              <div>
                    <div className="text-sm font-semibold text-slate-100">{meta.label}</div>
                    <div className="mt-2 text-3xl font-semibold tracking-tight text-emerald-300">
                      ${meta.promoFirstMonth}
                </div>
                    <div className="mt-1 text-[11px] text-slate-400 leading-relaxed">
                      First month, then ${meta.priceMonthly}/mo.
              </div>
            </div>
                  {isCurrent ? (
                    <div className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-200">
                      Current plan
              </div>
                  ) : null}
                </div>

                <div className="mt-4 text-sm text-slate-300 leading-relaxed">
                  {p === 'starter'
                    ? 'Stay organized and get paid on time.'
                    : p === 'growth'
                      ? 'Run operations without chaos as you get busier.'
                      : 'Feel confident because the system is watching for you.'}
                  </div>

                <div className="mt-auto pt-5">
                  <Link
                    href={startHref}
                    className={classNames(
                      'inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition',
                      isCurrent
                        ? 'border border-slate-800 bg-slate-950/40 text-slate-300 hover:bg-slate-900/60'
                        : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                    )}
                  >
                    {isCurrent ? 'Go to dashboard' : 'Start here'} <ArrowRight className="h-4 w-4" />
                  </Link>
                      </div>
                      </div>
            );
          })}
                      </div>
      </section>

      {/* Social proof (placeholder) */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <div className="rounded-3xl border border-slate-800 bg-slate-950/55 p-8 md:p-10">
          <div className="grid gap-6 md:grid-cols-2">
            {[
              {
                title: 'Built for solo and growing service businesses',
                desc: 'If you’re running jobs, managing clients, and trying to stay on top of payments — RevGuard is made for you.',
              },
              {
                title: 'Designed for owners who don’t want to think about finances daily',
                desc: 'You shouldn’t need a “finance day” to feel confident. RevGuard helps you stay calm and in control all week.',
              },
            ].map((c) => (
              <div key={c.title} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-6">
                <div className="text-lg font-semibold text-slate-100">{c.title}</div>
                <div className="mt-2 text-sm text-slate-300 leading-relaxed">{c.desc}</div>
                    </div>
            ))}
                </div>
            </div>
          </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/70 py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-400">
          <div className="flex items-center gap-2">
            <Image src="/logo.png" alt="RevGuard" width={20} height={20} className="h-5 w-5" />
            <span className="font-semibold text-slate-200">RevGuard</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/pricing" className="hover:text-slate-200 transition-colors">
              Pricing
            </Link>
            <Link href="/login" className="hover:text-slate-200 transition-colors">
              Log in
            </Link>
            <Link href="/signup" className="hover:text-slate-200 transition-colors">
              Sign up
            </Link>
          </div>
        </div>
      </footer>
      </div>
  );
}


