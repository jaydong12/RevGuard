"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../utils/supabaseClient';
import { useAppData } from '../../../components/AppDataProvider';
import { useToast } from '../../../components/ToastProvider';
import { loadStripe } from '@stripe/stripe-js';
import { Landmark, RotateCw } from 'lucide-react';
import { SettingsTabs } from '../SettingsTabs';

type ConnRow = { status: string | null; last_sync_at: string | null };
type AcctRow = { id: string; name: string | null; mask: string | null; currency: string | null };
type SyncRunRow = { status: string; started_at: string; finished_at: string | null; error_message: string | null };

function timeAgo(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  if (!Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

export default function SettingsBankingPage() {
  const { businessId, userId } = useAppData();
  const { pushToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [conn, setConn] = useState<ConnRow | null>(null);
  const [accounts, setAccounts] = useState<AcctRow[]>([]);
  const [lastRun, setLastRun] = useState<SyncRunRow | null>(null);

  const connected = Boolean(conn);

  const statusLine = useMemo(() => {
    return {
      lastSync: timeAgo(conn?.last_sync_at ?? null),
      accountCount: accounts.length,
      lastError: lastRun?.status === 'failed' ? String(lastRun?.error_message ?? 'Sync failed.') : null,
    };
  }, [conn, accounts.length, lastRun]);

  async function loadAll() {
    if (!businessId || !userId) {
      setConn(null);
      setAccounts([]);
      setLastRun(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const connRes = await supabase
        .from('bank_connections')
        .select('status,last_sync_at')
        .eq('business_id', businessId)
        .eq('provider', 'stripe_fc')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (connRes.error) throw connRes.error;
      setConn((connRes.data as any) ? (connRes.data as any as ConnRow) : null);

      const acctRes = await supabase
        .from('bank_accounts')
        .select('id,name,mask,currency')
        .eq('business_id', businessId)
        .eq('provider', 'stripe_fc')
        .order('created_at', { ascending: false });
      if (acctRes.error) throw acctRes.error;
      setAccounts(((acctRes.data as any[]) ?? []).map((r) => ({
        id: String(r.id),
        name: r.name ? String(r.name) : null,
        mask: r.mask ? String(r.mask) : null,
        currency: r.currency ? String(r.currency) : null,
      })));

      const runRes = await supabase
        .from('bank_sync_runs')
        .select('status,started_at,finished_at,error_message')
        .eq('business_id', businessId)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (runRes.error) throw runRes.error;
      setLastRun((runRes.data as any) ? (runRes.data as any as SyncRunRow) : null);
    } catch (e: any) {
      setError(String(e?.message ?? 'Failed to load banking.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, userId]);

  async function connectBank() {
    if (!businessId) return;
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch('/api/stripe/fc/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(String(json?.error ?? 'Failed to start bank connect.'));

      const clientSecret = String(json?.client_secret ?? '');
      const sessionId = String(json?.session_id ?? '');
      if (!clientSecret || !sessionId) throw new Error('Missing Stripe client_secret/session_id.');

      const pk = String((process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY as any) ?? '');
      if (!pk) throw new Error('Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.');
      const stripe = await loadStripe(pk);
      if (!stripe) throw new Error('Stripe.js failed to load.');

      const collect = (stripe as any).collectFinancialConnectionsAccounts;
      if (typeof collect !== 'function') throw new Error('Stripe.js Financial Connections is not available.');

      const collected = await collect.call(stripe, { clientSecret });
      if (collected?.error) throw new Error(String(collected.error?.message ?? 'Bank linking failed.'));

      const done = await fetch('/api/stripe/fc/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, session_id: sessionId }),
      });
      const doneJson = (await done.json().catch(() => null)) as any;
      if (!done.ok) throw new Error(String(doneJson?.error ?? 'Failed to complete bank connection.'));

      pushToast({ tone: 'ok', message: 'Bank connected.' });
      await loadAll();
    } catch (e: any) {
      setError(String(e?.message ?? 'Bank connect failed.'));
    } finally {
      setConnecting(false);
    }
  }

  async function syncNow() {
    if (!businessId) return;
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch('/api/stripe/fc/sync-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(String(json?.error ?? 'Sync failed.'));
      pushToast({ tone: 'ok', message: `Synced. Imported ${Number(json?.insertedCount ?? 0)} transactions.` });
      await loadAll();
    } catch (e: any) {
      setError(String(e?.message ?? 'Sync failed.'));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main className="space-y-3">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-slate-400 text-sm mt-1">Manage your account and preferences</p>
        </div>
      </header>

      <SettingsTabs />

      <div className="mx-auto w-full max-w-5xl pt-2">
        <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 md:p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/25">
            <Landmark className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Banking</h2>
            <p className="text-xs text-slate-400 mt-1">Connect your business bank to auto-import transactions.</p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={() => void connectBank()}
            disabled={!businessId || connecting}
            className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {connecting ? 'Connecting…' : 'Connect Bank'}
          </button>
          <button
            type="button"
            onClick={() => void syncNow()}
            disabled={!businessId || syncing || !connected}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCw className="h-4 w-4" />
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </div>

      {!userId ? (
        <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Please sign in to manage banking.
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <div className="text-[11px] text-slate-400">Last sync</div>
          <div className="mt-1 text-sm font-semibold text-slate-100">{statusLine.lastSync}</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <div className="text-[11px] text-slate-400">Accounts</div>
          <div className="mt-1 text-sm font-semibold text-slate-100">{statusLine.accountCount}</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <div className="text-[11px] text-slate-400">Last error</div>
          <div className="mt-1 text-sm font-semibold text-slate-100">
            {statusLine.lastError ? statusLine.lastError : '—'}
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className="text-sm font-semibold text-slate-100">Connected accounts</div>
        <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950/50">
          {loading ? (
            <div className="p-4 text-sm text-slate-300">Loading…</div>
          ) : accounts.length === 0 ? (
            <div className="p-4 text-sm text-slate-300">
              No connected accounts yet.
              <div className="mt-1 text-xs text-slate-400">Connect a bank to start importing transactions.</div>
            </div>
          ) : (
            <ul className="divide-y divide-slate-800">
              {accounts.map((a) => (
                <li key={a.id} className="p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">
                      {a.name ?? 'Bank account'}
                      {a.mask ? <span className="text-slate-400 font-normal"> •••• {a.mask}</span> : null}
                    </div>
                    <div className="text-xs text-slate-400">{a.currency ?? '—'}</div>
                  </div>
                  <div className="text-xs text-slate-400">{connected ? 'Connected' : '—'}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
        </section>
      </div>
    </main>
  );
}


