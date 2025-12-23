'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthCard } from '../../components/AuthCard';
import { supabase } from '../../utils/supabaseClient';
import { getOrCreateBusinessId } from '../../lib/getOrCreateBusinessId';

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

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-400">Loading…</div>}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();

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

  async function businessProfileIncompleteForUser(userId: string): Promise<boolean> {
    const bizId = await getOrCreateBusinessId(supabase);
    const { data: biz, error } = await supabase
      .from('business')
      .select('id, name, email, phone')
      .eq('id', bizId)
      .maybeSingle();

    if (error || !biz) return true;

    const name = String((biz as any)?.name ?? '').trim();
    const emailV = String((biz as any)?.email ?? '').trim();
    const phoneV = String((biz as any)?.phone ?? '').trim();
    return !name || (!emailV && !phoneV);
  }

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
      setAuthCookie(sess.session?.access_token ?? null);
      const userId = sess.session?.user?.id ?? null;
      const userEmail = String(sess.session?.user?.email ?? '').trim().toLowerCase();
      if (!userId) {
        router.replace('/login?redirect=/pricing');
        return;
      }

      if (userEmail && ADMIN_EMAILS.includes(userEmail)) {
        router.replace('/dashboard');
        return;
      }

      // Ensure business exists and route to Business Profile if incomplete.
      try {
        const needsBizProfile = await businessProfileIncompleteForUser(userId);
        if (needsBizProfile) {
          router.replace('/settings');
          return;
        }
      } catch {
        // ignore; fall through to paywall logic
      }

      const status = await getSubscriptionStatus(userId);

      if (status !== 'active') router.replace('/pricing');
      else router.replace('/dashboard');
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
      const siteUrl =
        (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '') ||
        window.location.origin;
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${siteUrl}/login`,
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
                  href="/signup"
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


