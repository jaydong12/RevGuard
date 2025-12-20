'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthCard } from '../../components/AuthCard';
import { supabase } from '../../utils/supabaseClient';

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-400">Loading…</div>}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('redirect') || params.get('next') || '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user?.id ?? null;
      if (!userId) {
        router.replace('/login?redirect=/pricing');
        return;
      }

      const status = await getSubscriptionStatus(userId);

      if (status !== 'active') router.replace('/pricing');
      else router.replace(next);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('LOGIN_ERROR', err);
      setError(err?.message ?? 'Login failed.');
    } finally {
      setLoading(false);
    }
  }

  async function forgotPassword() {
    setLoading(true);
    setError(null);
    setNote(null);
    try {
      if (!email.trim()) {
        setError('Enter your email first.');
        return;
      }
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login`,
      });
      if (error) throw error;
      setNote('Password reset email sent. Check your inbox.');
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('RESET_PASSWORD_ERROR', err);
      setError(err?.message ?? 'Could not send reset email.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
        <AuthCard
          title="Account"
          subtitle="Sign in to access your RevGuard workspace."
          compact
          badge={
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950/70 px-3 py-1 text-[10px] font-semibold text-slate-200">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
              Not signed in
            </div>
          }
          footer={
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <div>
                New to RevGuard?{' '}
                <Link
                  className="text-emerald-200 hover:text-emerald-100"
                  href={`/signup?redirect=${encodeURIComponent(next)}`}
                >
                  Create an account
                </Link>
              </div>
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

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={forgotPassword}
                className="text-xs text-slate-300 hover:text-slate-100"
                disabled={loading}
              >
                Forgot password?
              </button>
            </div>

            {error && <div className="text-sm text-rose-300">{error}</div>}
            {note && <div className="text-sm text-emerald-200">{note}</div>}

            <button
              type="submit"
              disabled={loading}
              className={classNames(
                'w-full rounded-xl px-4 py-2 text-sm font-semibold transition shadow-[0_0_0_1px_rgba(148,163,184,0.10)]',
                loading
                  ? 'bg-slate-800 text-slate-400'
                  : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
              )}
            >
              {loading ? 'Logging in…' : 'Log in'}
            </button>
          </form>
        </AuthCard>
    </main>
  );
}


