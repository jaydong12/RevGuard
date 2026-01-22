"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../utils/supabaseClient';
import { AuthCard } from '../../components/AuthCard';

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

export default function ResetPasswordPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const tokenInfo = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const h = (window.location.hash || '').replace(/^#/, '');
    const sp = new URLSearchParams(h);
    const access_token = sp.get('access_token');
    const refresh_token = sp.get('refresh_token');
    const type = sp.get('type');
    return { code, access_token, refresh_token, type };
  }, []);

  useEffect(() => {
    (async () => {
      setError(null);
      try {
        // Recovery links may arrive as:
        // - PKCE: /reset-password?code=...
        // - Implicit: /reset-password#access_token=...&refresh_token=...&type=recovery
        if (tokenInfo?.code) {
          const { error } = await supabase.auth.exchangeCodeForSession(tokenInfo.code);
          if (error) throw error;
        } else if (tokenInfo?.access_token && tokenInfo?.refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token: tokenInfo.access_token,
            refresh_token: tokenInfo.refresh_token,
          });
          if (error) throw error;
        }

        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        setAuthCookie(token);

        if (!data.session?.user?.id) {
          throw new Error('Recovery link is invalid or expired. Request a new reset email.');
        }

        // Clean URL (remove tokens) for safety.
        try {
          window.history.replaceState({}, '', '/reset-password');
        } catch {
          // ignore
        }
        setReady(true);
      } catch (e: any) {
        setReady(false);
        setError(String(e?.message ?? 'Could not start password recovery.'));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNote(null);
    try {
      if (!ready) throw new Error('Recovery session is not ready yet.');
      if (!password.trim()) throw new Error('Password is required.');
      if (password !== confirm) throw new Error('Passwords do not match.');

      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      setNote('Password updated.');
      router.replace('/onboarding');
    } catch (e: any) {
      setError(String(e?.message ?? 'Could not reset password.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <AuthCard
        title="Reset password"
        subtitle="Choose a new password for your account."
        compact
        footer={<div className="text-[11px] text-slate-400">After saving, you’ll continue to setup.</div>}
      >
        <form onSubmit={submit} className="space-y-3">
          {!ready ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-200">
              Preparing secure password reset…
            </div>
          ) : null}

          <label className="block text-xs text-slate-300">
            New password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-xl bg-slate-950/60 border border-slate-800 px-3 py-2 text-sm text-slate-100"
              autoComplete="new-password"
              disabled={!ready || loading}
            />
          </label>
          <label className="block text-xs text-slate-300">
            Confirm password
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-1 w-full rounded-xl bg-slate-950/60 border border-slate-800 px-3 py-2 text-sm text-slate-100"
              autoComplete="new-password"
              disabled={!ready || loading}
            />
          </label>

          {error ? <div className="text-sm text-rose-300">{error}</div> : null}
          {note ? <div className="text-sm text-emerald-200">{note}</div> : null}

          <button
            type="submit"
            disabled={!ready || loading}
            className={
              'w-full rounded-xl px-4 py-2 text-sm font-semibold transition shadow-[0_0_0_1px_rgba(148,163,184,0.10)] ' +
              (loading ? 'bg-slate-800 text-slate-400' : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400')
            }
          >
            {loading ? 'Saving…' : 'Save new password'}
          </button>
        </form>
      </AuthCard>
    </main>
  );
}


