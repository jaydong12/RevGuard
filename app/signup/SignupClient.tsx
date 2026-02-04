'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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

export default function SignupClient() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-400">Loading…</div>}>
      <SignupInner />
    </Suspense>
  );
}

function SignupInner() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

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

      const origin =
        (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '') ||
        (typeof window !== 'undefined' ? window.location.origin : '');
      const emailRedirectTo = origin ? `${origin}/auth/callback` : undefined;

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: emailRedirectTo ? { emailRedirectTo } : undefined,
      });
      if (error) throw error;

      // If email confirmation is off, we get a session immediately.
      if (data.session?.access_token) {
        setAuthCookie(data.session.access_token);
        router.replace('/onboarding/business');
        return;
      }

      // Email confirmation required: route to check-email screen.
      router.replace('/check-email?next=/onboarding/business');
      return;
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
            <Link className="text-emerald-200 hover:text-emerald-100" href="/login">
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
              loading ? 'bg-slate-800 text-slate-400' : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
            )}
          >
            {loading ? 'Creating…' : 'Create account'}
          </button>
        </form>
      </AuthCard>
    </main>
  );
}


