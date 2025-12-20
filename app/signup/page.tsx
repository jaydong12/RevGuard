'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthCard } from '../../components/AuthCard';
import { supabase } from '../../utils/supabaseClient';

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-400">Loading…</div>}>
      <SignupInner />
    </Suspense>
  );
}

function SignupInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('redirect') || params.get('next') || '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function getSubscriptionStatus(userId: string): Promise<string> {
    const first = await supabase
      .from('business')
      .select('id, subscription_status')
      .eq('owner_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    // If the row doesn't exist yet (trigger not applied / race), treat as inactive (paywall).
    if (first.error || !first.data?.id) return 'inactive';

    return String((first.data as any)?.subscription_status ?? 'inactive').toLowerCase();
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      if (data.session) {
        const userId = data.session.user.id;
        const status = await getSubscriptionStatus(userId);

        if (status !== 'active') router.replace('/pricing');
        else router.replace(next);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNote(null);
    try {
      if (!email.trim() || !password.trim()) {
        setError('Email and password are required.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }

      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;

      // If email confirmation is off, we get a session immediately.
      if (data.session) {
        // Paywall: if not active, redirect to pricing after signup.
        const userId = data.session.user.id;
        const status = await getSubscriptionStatus(userId);

        if (status !== 'active') router.replace('/pricing');
        else router.replace(next);
        return;
      }

      setNote('Account created. Check your email to confirm, then log in.');
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('SIGNUP_ERROR', err);
      setError(err?.message ?? 'Sign up failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
        <AuthCard
          title="Create your account"
          subtitle="Everything included. One price."
          footer={
            <div className="text-[11px] text-slate-400">
              Already have an account?{' '}
              <Link
                className="text-emerald-200 hover:text-emerald-100"
                href={`/login?redirect=${encodeURIComponent(next)}`}
              >
                Log in
              </Link>
            </div>
          }
        >
          <form onSubmit={submit} className="space-y-3">
            <label className="block text-xs text-slate-300">
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-xl bg-slate-950/60 border border-slate-800 px-3 py-2 text-sm text-slate-100"
              />
            </label>
            <label className="block text-xs text-slate-300">
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-xl bg-slate-950/60 border border-slate-800 px-3 py-2 text-sm text-slate-100"
              />
            </label>
            <label className="block text-xs text-slate-300">
              Confirm password
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1 w-full rounded-xl bg-slate-950/60 border border-slate-800 px-3 py-2 text-sm text-slate-100"
              />
            </label>

            {error && <div className="text-sm text-rose-300">{error}</div>}
            {note && <div className="text-sm text-emerald-200">{note}</div>}

            <button
              type="submit"
              disabled={loading}
              className={classNames(
                'w-full rounded-xl px-4 py-2 text-sm font-semibold transition',
                loading
                  ? 'bg-slate-800 text-slate-400'
                  : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
              )}
            >
              {loading ? 'Creating…' : 'Create account'}
            </button>
          </form>
        </AuthCard>
    </main>
  );
}


