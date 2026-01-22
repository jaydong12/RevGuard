'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseEnvError } from '../utils/supabaseClient';

type Props = {
  children: React.ReactNode;
};

async function pingSupabase(params: { url: string; anonKey: string; timeoutMs: number }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    // Any HTTP response means "reachable". Blocks/timeouts will throw.
    const res = await fetch(`${params.url.replace(/\/+$/, '')}/rest/v1/`, {
      method: 'GET',
      headers: {
        apikey: params.anonKey,
        Authorization: `Bearer ${params.anonKey}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    return { ok: true as const, status: res.status };
  } catch (e: any) {
    const aborted = String(e?.name ?? '') === 'AbortError';
    return { ok: false as const, aborted };
  } finally {
    clearTimeout(t);
  }
}

export function HealthGate({ children }: Props) {
  const envError = getSupabaseEnvError();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  const host = useMemo(() => {
    try {
      return supabaseUrl ? new URL(supabaseUrl).host : null;
    } catch {
      return null;
    }
  }, [supabaseUrl]);

  const [state, setState] = useState<
    | { status: 'checking' }
    | { status: 'ok' }
    | { status: 'blocked'; reason: string }
  >({ status: 'checking' });

  const run = useCallback(async () => {
    if (envError) {
      setState({ status: 'blocked', reason: envError });
      return;
    }
    if (!supabaseUrl || !anonKey) {
      setState({ status: 'blocked', reason: 'Supabase is not configured.' });
      return;
    }

    setState({ status: 'checking' });
    const res = await pingSupabase({ url: supabaseUrl, anonKey, timeoutMs: 6000 });
    if (res.ok) {
      setState({ status: 'ok' });
    } else {
      setState({
        status: 'blocked',
        reason: res.aborted
          ? 'Supabase request timed out.'
          : 'Unable to reach Supabase from this network.',
      });
    }
  }, [envError, supabaseUrl, anonKey]);

  useEffect(() => {
    void run();
  }, [run]);

  if (state.status === 'ok') return <>{children}</>;

  if (state.status === 'checking') {
    return (
      <div className="min-h-[calc(100vh-80px)] flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950/50 backdrop-blur-sm p-6">
          <div className="text-sm font-semibold text-slate-100">Checking connection…</div>
          <div className="mt-2 text-sm text-slate-300">Verifying Supabase access (6s timeout).</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-80px)] flex items-center justify-center px-4">
      <div className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-950/50 backdrop-blur-sm p-8">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/60 text-slate-200">
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
              <path
                d="M12 9v4m0 4h.01"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path
                d="M10.3 3.7h3.4L21 21H3L10.3 3.7Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-xl font-semibold tracking-tight text-slate-50">
              Network blocking RevGuard
            </div>
            <div className="mt-2 text-sm text-slate-300 leading-relaxed">
              RevGuard can’t reach its backend right now.
            </div>
            <div className="mt-2 text-sm text-slate-300 leading-relaxed">
              <span className="text-slate-200 font-semibold">Reason:</span> {state.reason}
            </div>
          </div>
        </div>

        <div className="mt-6 space-y-2 text-sm text-slate-300 leading-relaxed">
          <div className="text-slate-200 font-semibold">Try this:</div>
          <ul className="list-disc pl-5 space-y-1">
            <li>Switch networks (try cellular hotspot) or disable VPN.</li>
            <li>Allowlist your Supabase domain in firewall/proxy rules.</li>
            <li>If you’re on a corporate network, ask IT to allow HTTPS to Supabase.</li>
          </ul>
          {host ? (
            <div className="mt-2 text-[12px] text-slate-400">
              Supabase host: <span className="text-slate-200">{host}</span>
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void run()}
            className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
          >
            Retry
          </button>
          <a
            className="text-sm text-slate-300 hover:text-slate-100 underline"
            href="/login"
          >
            Go to login
          </a>
        </div>
      </div>
    </div>
  );
}


