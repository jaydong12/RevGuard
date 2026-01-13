'use client';

import React, { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthCard } from '../../components/AuthCard';
import { supabase } from '../../utils/supabaseClient';

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

function setAuthCookie(token: string | null) {
  try {
    if (!token) {
      document.cookie = `rg_at=; Path=/; Max-Age=0; SameSite=Lax`;
      return;
    }
    document.cookie = `rg_at=${encodeURIComponent(token)}; Path=/; Max-Age=604800; SameSite=Lax`;
  } catch {
    // ignore
  }
}

const ADMIN_EMAILS = ['jaydongant@gmail.com', 'shannon_g75@yahoo.com'].map((e) =>
  e.toLowerCase()
);

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-400">Loading…</div>}>
      <SignupWizard />
    </Suspense>
  );
}

type Industry =
  | 'contractor'
  | 'restaurant'
  | 'retail'
  | 'services'
  | 'real_estate'
  | 'other';

function normalizeIndustry(raw: string): Industry | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (
    s === 'contractor' ||
    s === 'restaurant' ||
    s === 'retail' ||
    s === 'services' ||
    s === 'real_estate' ||
    s === 'other'
  ) {
    return s;
  }
  return null;
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full rounded-full bg-slate-800/70 overflow-hidden">
      <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

function SignupWizard() {
  const router = useRouter();
  const params = useSearchParams();
  const next = String(params.get('next') ?? '').trim();
  const plan = String(params.get('plan') ?? '').trim().toLowerCase();

  function normalizePlanId(raw: string): 'starter' | 'growth' | 'pro' | null {
    const s = String(raw ?? '').trim().toLowerCase();
    if (s === 'starter' || s === 'growth' || s === 'pro') return s;
    return null;
  }

  const requestedPlan = normalizePlanId(plan);

  const [step, setStep] = useState(0); // 0..3
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Step 1–2 local state (held until step 3 submit)
  const [fullName, setFullName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [industry, setIndustry] = useState<Industry | ''>('');

  // Step 3 account
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const pct = useMemo(() => Math.round(((step + 1) / 4) * 100), [step]);

  function back() {
    setError(null);
    setNote(null);
    setStep((s) => Math.max(0, s - 1));
  }

  async function continueOrSubmit() {
    setError(null);
    setNote(null);

    if (step === 0) {
      const name = fullName.trim();
      if (!name) {
        setError('Full name is required.');
        return;
      }
      setStep(1);
      return;
    }

    if (step === 1) {
      const bn = businessName.trim();
      const ind = industry ? normalizeIndustry(industry) : null;
      if (!bn) {
        setError('Business name is required.');
        return;
      }
      if (!ind) {
        setError('Select an industry.');
        return;
      }
      setStep(2);
      return;
    }

    if (step === 2) {
      const em = email.trim();
      const pw = password.trim();
      if (!em || !pw) {
        setError('Email and password are required.');
        return;
      }

      const bn = businessName.trim();
      const ind = industry ? normalizeIndustry(industry) : null;
      if (!fullName.trim() || !bn || !ind) {
        setError('Missing setup details. Please go back and complete the earlier steps.');
        return;
      }

      setLoading(true);
      try {
        const { data, error } = await supabase.auth.signUp({ email: em, password: pw });
        if (error) throw error;

        // If email confirmation is enabled, there may be no session; we cannot write user-owned rows.
        if (!data.session || !data.user?.id) {
          const base = 'Account created. Check your email to confirm, then log in.';
          const follow = requestedPlan
            ? ` After logging in, we’ll continue checkout for the ${requestedPlan} plan.`
            : '';
          setNote(base + follow);
          setStep(3);
          return;
        }

        const token = data.session.access_token ?? null;
        setAuthCookie(token);

        const userId = String(data.user.id);
        const userEmail = String(data.user.email ?? '').trim().toLowerCase();
        if (userEmail && ADMIN_EMAILS.includes(userEmail)) {
          router.replace('/dashboard');
          return;
        }

        // 1) upsert profile
        const up = await supabase
          .from('profiles')
          .upsert(
            {
              id: userId,
              full_name: fullName.trim(),
              onboarding_step: 999,
              onboarding_complete: true,
            } as any,
            { onConflict: 'id' }
          )
          .select('id')
          .single();
        if (up.error) throw up.error;

        // 2) insert business row
        const biz = await supabase
          .from('business')
          .insert(
            {
              owner_id: userId,
              name: bn,
              industry: ind,
              onboarding_step: 999,
              onboarding_complete: true,
            } as any
          )
          .select('id')
          .single();
        if (biz.error || !biz.data?.id) throw biz.error ?? new Error('Failed to create business.');
        const businessId = String((biz.data as any).id);

        // 3) insert owner membership
        const mem = await supabase
          .from('business_members')
          .insert({ business_id: businessId, user_id: userId, role: 'owner' } as any)
          .select('id')
          .single();
        if (mem.error) throw mem.error;

        setStep(3);
        if (requestedPlan) {
          router.replace(`/pricing?plan=${encodeURIComponent(requestedPlan)}`);
        } else {
          router.replace(next && next.startsWith('/') ? next : '/dashboard');
        }
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error('SIGNUP_WIZARD_ERROR', e);
        setError(String(e?.message ?? 'Sign up failed.'));
      } finally {
        setLoading(false);
      }

      return;
    }

    if (step === 3) {
      if (requestedPlan) {
        router.replace(`/pricing?plan=${encodeURIComponent(requestedPlan)}`);
        return;
      }
      router.replace(next && next.startsWith('/') ? next : '/dashboard');
    }
  }

  return (
    <main>
      <AuthCard
        title="Create your account"
        subtitle="Quick setup. One question per screen."
        footer={
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <div>
              Already have an account?{' '}
              <Link
                className="relative z-10 inline-flex items-center text-emerald-200 hover:text-emerald-100 underline underline-offset-2"
                href="/login"
              >
                Log in
              </Link>
            </div>
            <div className="text-slate-500">Step {step + 1}/4</div>
          </div>
        }
      >
        <div className="space-y-4">
          <ProgressBar value={pct} />

          {step === 0 ? (
            <div className="space-y-3">
              <div className="text-sm font-semibold text-slate-100">What should we call you?</div>
              <label className="block text-xs text-slate-300">
                Full name
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-1 w-full rounded-xl bg-slate-950/60 border border-slate-800 px-3 py-2 text-sm text-slate-100"
                  placeholder="Jane Doe"
                  autoComplete="name"
                />
              </label>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-3">
              <div className="text-sm font-semibold text-slate-100">Your business</div>
              <label className="block text-xs text-slate-300">
                Business name
                <input
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="mt-1 w-full rounded-xl bg-slate-950/60 border border-slate-800 px-3 py-2 text-sm text-slate-100"
                  placeholder="Acme Services"
                />
              </label>

              <div className="text-xs text-slate-300">Industry</div>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { id: 'contractor', label: 'Contractor' },
                  { id: 'restaurant', label: 'Restaurant' },
                  { id: 'retail', label: 'Retail' },
                  { id: 'services', label: 'Services' },
                  { id: 'real_estate', label: 'Real Estate' },
                  { id: 'other', label: 'Other' },
                ] as Array<{ id: Industry; label: string }>).map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => setIndustry(x.id)}
                    className={classNames(
                      'rounded-xl border px-3 py-3 text-left transition',
                      industry === x.id
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
                        : 'border-slate-800 bg-slate-950/40 text-slate-200 hover:bg-slate-900/50'
                    )}
                  >
                    <div className="text-sm font-semibold">{x.label}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-3">
              <div className="text-sm font-semibold text-slate-100">Create your login</div>
              <label className="block text-xs text-slate-300">
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-xl bg-slate-950/60 border border-slate-800 px-3 py-2 text-sm text-slate-100"
                  autoComplete="email"
                />
              </label>
              <label className="block text-xs text-slate-300">
                Password
                <div className="mt-1 relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl bg-slate-950/60 border border-slate-800 px-3 py-2 pr-12 text-sm text-slate-100"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-950/40 text-slate-200 hover:bg-slate-900/60"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                        <path
                          d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <path
                          d="M4 4l16 16"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                        <path
                          d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                      </svg>
                    )}
                  </button>
                </div>
              </label>
              <div className="text-[11px] text-slate-500">
                By continuing, you’ll create your RevGuard account.
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-2">
              <div className="text-sm font-semibold text-slate-100">Success</div>
              <div className="text-xs text-slate-400">
                {note ?? 'Your workspace is ready.'}
              </div>
            </div>
          ) : null}

          {error ? <div className="text-sm text-rose-300">{error}</div> : null}
          {note && step !== 3 ? <div className="text-sm text-emerald-200">{note}</div> : null}

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={back}
              disabled={loading || step === 0}
              className={classNames(
                'rounded-xl border px-4 py-2 text-sm font-semibold transition',
                loading || step === 0
                  ? 'border-slate-800 bg-slate-950/30 text-slate-500 cursor-not-allowed'
                  : 'border-slate-800 bg-slate-950/40 text-slate-200 hover:bg-slate-900/60'
              )}
            >
              Back
            </button>
            <button
              type="button"
              onClick={continueOrSubmit}
              disabled={loading}
              className={classNames(
                'rounded-xl px-4 py-2 text-sm font-semibold transition',
                loading
                  ? 'bg-slate-800 text-slate-400 cursor-not-allowed'
                  : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
              )}
            >
              {step === 2 ? (loading ? 'Creating…' : 'Create account') : step === 3 ? 'Go to dashboard' : 'Continue'}
            </button>
          </div>
        </div>
      </AuthCard>
    </main>
  );
}


