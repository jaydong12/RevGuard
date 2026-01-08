'use client';

import React from 'react';
import { useSearchParams } from 'next/navigation';
import { useAppData } from '../../components/AppDataProvider';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../utils/supabaseClient';
import { PLAN_FEATURES, type PlanId } from '../../lib/plans';
import { StartPlanButton } from '../../components/StartPlanButton';

export default function PricingPage() {
  const params = useSearchParams();
  const upgrade = String(params.get('upgrade') ?? '').trim().toLowerCase();
  const { business, userEmail } = useAppData();

  const isAdmin =
    String(userEmail ?? '').trim().toLowerCase() === 'jaydongant@gmail.com' ||
    String(userEmail ?? '').trim().toLowerCase() === 'shannon_g75@yahoo.com';

  const plansQ = useQuery({
    queryKey: ['subscription_plans_public_v1'],
    queryFn: async () => {
      const res = await fetch('/api/subscription-plans', { cache: 'no-store' });
      const body = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(body?.error ?? 'Failed to load plans.');
      const plans = (body?.plans ?? []) as any[];
      return plans as Array<{
        id: string;
        label: string;
        priceMonthly: number | null;
        promoFirstMonth: number | null;
      }>;
    },
  });

  const [currentPlan, setCurrentPlan] = React.useState<PlanId>('none');

  React.useEffect(() => {
    let alive = true;
    async function load() {
      try {
        if (isAdmin) {
          if (alive) setCurrentPlan('pro');
          return;
        }
        const { data } = await supabase.auth.getSession();
        const sess = data.session ?? null;
        if (!sess?.user?.id) {
          if (alive) setCurrentPlan('none');
          return;
        }
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('plan_id,status,current_period_end')
          .eq('user_id', sess.user.id)
          .maybeSingle();

        const status = String((sub as any)?.status ?? 'inactive').trim().toLowerCase();
        const planId = String((sub as any)?.plan_id ?? '').trim().toLowerCase();
        const cpe = (sub as any)?.current_period_end ? String((sub as any).current_period_end) : null;

        const okStatus = status === 'active' || status === 'trialing';
        const okPeriod = !cpe ? true : (() => {
          const d = new Date(cpe);
          return Number.isNaN(d.getTime()) ? true : d.getTime() > Date.now();
        })();

        if (!okStatus || !okPeriod) {
          if (alive) setCurrentPlan('none');
          return;
        }
        const plan: PlanId = planId === 'starter' ? 'starter' : planId === 'growth' ? 'growth' : planId === 'pro' ? 'pro' : 'pro';
        if (alive) setCurrentPlan(plan);
      } catch {
        if (alive) setCurrentPlan('none');
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  return (
    <main className="space-y-10 py-2">
        <header className="space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-50">
            Pricing
          </h1>
          <p className="text-slate-300 text-sm md:text-base leading-relaxed max-w-2xl">
            <span className="text-slate-100 font-semibold">
              Choose a plan that fits your business.
            </span>{' '}
            Simple monthly billing. Upgrade any time.
          </p>
        </header>

        {upgrade === 'starter' || upgrade === 'growth' || upgrade === 'pro' ? (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            Upgrade required: this feature needs the{' '}
            <span className="font-semibold">{upgrade}</span> plan.
          </div>
        ) : null}

        <section className="w-full max-w-[980px] mx-auto">
          <div className="grid md:grid-cols-3 gap-4 md:gap-6 items-stretch">
            {(plansQ.data ?? [])
              .slice()
              .sort((a, b) => {
                const order = (id: string) => (id === 'starter' ? 0 : id === 'growth' ? 1 : id === 'pro' ? 2 : 99);
                return order(String(a.id)) - order(String(b.id));
              })
              .map((p) => {
              const plan = (String(p.id).trim().toLowerCase() as any) as Exclude<PlanId, 'none'>;
              const isCurrent = currentPlan === plan;
              const highlight = upgrade === plan;
              const features = PLAN_FEATURES[plan] ?? [];

              return (
                <div
                  key={plan}
                  className={`rounded-3xl border bg-slate-950/45 backdrop-blur-sm shadow-[0_30px_90px_rgba(0,0,0,0.35)] overflow-hidden ${
                    highlight ? 'border-emerald-500/40 shadow-emerald-500/10' : 'border-slate-800/80'
                  }`}
                >
                  <div className="p-6 md:p-7 h-full flex flex-col">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                          {p.label}
                        </div>
                        <div className="mt-2 text-4xl font-semibold tracking-tight text-slate-100">
                          {typeof p.priceMonthly === 'number' ? `$${p.priceMonthly}` : '—'}
                          <span className="ml-1 text-sm font-medium text-slate-500">/mo</span>
                        </div>
                        <div className="mt-2 text-[11px] text-slate-400 leading-relaxed">
                          {typeof p.promoFirstMonth === 'number' && typeof p.priceMonthly === 'number' ? (
                            <>
                              First month{' '}
                              <span className="font-semibold text-slate-100">${p.promoFirstMonth}</span>, then ${p.priceMonthly}/mo.
                            </>
                          ) : typeof p.priceMonthly === 'number' ? (
                            <>Billed monthly at ${p.priceMonthly}/mo.</>
                          ) : (
                            <>Billed monthly.</>
                          )}
                        </div>
                      </div>
                      {isCurrent ? (
                        <div className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-200">
                          Current plan
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-5">
                      <div className="text-xs font-semibold text-slate-200">Included</div>
                      <ul className="mt-3 space-y-2 text-sm text-slate-200 leading-relaxed">
                        {features.map((f) => (
                          <li key={f} className="flex items-start gap-3">
                            <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-300 text-[11px] border border-emerald-500/20">
                              ✓
                            </span>
                            <span className="capitalize">{String(f).replace(/_/g, ' ')}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="mt-auto pt-6">
                      <StartPlanButton
                        plan={plan}
                        label={isCurrent ? 'Current plan' : `Start ${p.label}`}
                        disabled={isCurrent}
                        className={`w-full px-4 py-2.5 rounded-xl font-semibold transition ${
                          isCurrent
                            ? 'bg-slate-900/60 text-slate-300 border border-slate-800 cursor-not-allowed'
                            : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                        }`}
                      />
                      <div className="mt-2 text-[11px] text-slate-500">
                        Prices in USD • billed monthly • 1 business per account
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {plansQ.isLoading ? (
            <div className="mt-4 text-xs text-slate-400">Loading plans…</div>
          ) : plansQ.error ? (
            <div className="mt-4 text-xs text-rose-300">{String((plansQ.error as any)?.message ?? 'Could not load plans.')}</div>
          ) : null}
        </section>
    </main>
  );
}


