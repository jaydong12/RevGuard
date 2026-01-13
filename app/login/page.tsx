'use client';

import React, { Suspense, useState } from 'react';
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
  const nextParam = String(params.get('next') ?? '').trim();
  const planParam = String(params.get('plan') ?? '').trim().toLowerCase();
  const legacyRedirectParam = params.get('redirect');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function normalizeNextPath(raw: string): string | null {
    if (!raw) return null;
    // Only allow same-origin relative paths.
    if (!raw.startsWith('/')) return null;
    // Avoid weird protocol-relative URLs.
    if (raw.startsWith('//')) return null;
    // Avoid loops.
    if (raw === '/login' || raw.startsWith('/login/')) return '/dashboard';
    if (raw === '/signup' || raw.startsWith('/signup/')) return '/dashboard';
    return raw;
  }

  function normalizePlanId(raw: string): 'starter' | 'growth' | 'pro' | null {
    const s = String(raw ?? '').trim().toLowerCase();
    if (s === 'starter' || s === 'growth' || s === 'pro') return s;
    return null;
  }

  // Hard sanitizer: if legacy `redirect` param exists at all (e.g. /login?redirect=/login),
  // immediately replace the URL to a safe canonical form.
  React.useEffect(() => {
    if (legacyRedirectParam === null) return;
    router.replace('/login?next=/dashboard');
  }, [legacyRedirectParam, router]);

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
        setError('Login succeeded, but your session could not be loaded. Please refresh and try again.');
        return;
      }

      if (userEmail && ADMIN_EMAILS.includes(userEmail)) {
        router.replace('/dashboard');
        return;
      }

      // Honor a requested post-login destination (e.g. pricing -> continue checkout).
      const nextPath = normalizeNextPath(nextParam);
      const plan = normalizePlanId(planParam);
      if (nextPath === '/pricing' && plan) {
        router.replace(`/pricing?plan=${encodeURIComponent(plan)}`);
        return;
      }
      if (nextPath) {
        router.replace(nextPath);
        return;
      }

      router.replace('/dashboard');
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
              <div>
                <Link className="text-slate-300 hover:text-slate-100" href="/clock">
                  Employee Clock
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
              <div className="mt-1 relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl bg-slate-950/60 border border-slate-800 px-3 py-2 pr-12 text-sm text-slate-100"
                  autoComplete="current-password"
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


