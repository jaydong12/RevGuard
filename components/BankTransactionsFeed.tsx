"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { useAppData } from './AppDataProvider';
import { useToast } from './ToastProvider';
import { formatCurrency } from '../lib/formatCurrency';
import { loadStripe } from '@stripe/stripe-js';

type CategoryRow = { id: string; name: string };

type BankTx = {
  id: string;
  posted_at: string;
  amount: number;
  currency: string;
  merchant_name: string | null;
  description: string | null;
  tx_category_id: string | null;
  category_source: string;
  confidence: number;
  needs_review: boolean;
  created_at: string;
};

const DEMO_TX: BankTx[] = [
  {
    id: 'demo-1',
    posted_at: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
    amount: -189.23,
    currency: 'USD',
    merchant_name: 'Slack',
    description: 'Slack subscription',
    tx_category_id: null,
    category_source: 'demo',
    confidence: 1,
    needs_review: false,
    created_at: new Date().toISOString(),
  },
  {
    id: 'demo-2',
    posted_at: new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10),
    amount: -42.18,
    currency: 'USD',
    merchant_name: 'Shell',
    description: 'Fuel',
    tx_category_id: null,
    category_source: 'demo',
    confidence: 1,
    needs_review: false,
    created_at: new Date().toISOString(),
  },
  {
    id: 'demo-3',
    posted_at: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
    amount: 1250.0,
    currency: 'USD',
    merchant_name: 'Client payment',
    description: 'Invoice paid',
    tx_category_id: null,
    category_source: 'demo',
    confidence: 1,
    needs_review: false,
    created_at: new Date().toISOString(),
  },
];

function normMerchantKey(v: string | null | undefined) {
  return String(v ?? '').trim().toLowerCase();
}

function timeAgo(iso: string) {
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

export function BankTransactionsFeed() {
  const { businessId, userId } = useAppData();
  const { pushToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [rows, setRows] = useState<BankTx[]>([]);
  const [connectionInfo, setConnectionInfo] = useState<{
    status: string | null;
    last_sync_at: string | null;
  } | null>(null);
  const [showDemo, setShowDemo] = useState(false);

  const [pendingCategory, setPendingCategory] = useState<Record<string, string>>({});
  const [applyRule, setApplyRule] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const list = (showDemo ? DEMO_TX : rows) ?? [];
    if (!needsReviewOnly) return list;
    return list.filter((r) => Boolean(r.needs_review));
  }, [rows, needsReviewOnly, showDemo]);

  async function loadCategories() {
    if (!businessId) return;
    const res = await supabase
      .from('tx_categories')
      .select('id,name')
      .eq('business_id', businessId)
      .order('name', { ascending: true });
    if (res.error) throw res.error;
    const list = ((res.data as any[]) ?? []).map((r) => ({ id: String(r.id), name: String(r.name ?? '') }));
    if (list.length > 0) {
      setCategories(list);
      return;
    }

    // Phase 1: minimal default set (Phase 2 will add business_type presets + starter rules).
    const defaults = [
      'uncategorized',
      'income',
      'rent',
      'utilities',
      'software',
      'supplies',
      'advertising',
      'fees',
      'meals',
      'travel',
    ];

    // tx_categories are writable only for owner/manager/admin; ignore errors here.
    await supabase.from('tx_categories').insert(defaults.map((name) => ({ business_id: businessId, name })) as any);

    const again = await supabase
      .from('tx_categories')
      .select('id,name')
      .eq('business_id', businessId)
      .order('name', { ascending: true });
    if (!again.error) {
      setCategories(((again.data as any[]) ?? []).map((r) => ({ id: String(r.id), name: String(r.name ?? '') })));
    } else {
      setCategories([]);
    }
  }

  async function loadConnectionInfo() {
    if (!businessId) {
      setConnectionInfo(null);
      return null as any;
    }
    const res = await supabase
      .from('bank_connections')
      .select('status,last_sync_at')
      .eq('business_id', businessId)
      .eq('provider', 'stripe_fc')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (res.error) throw res.error;
    const row = res.data as any;
    if (!row) {
      setConnectionInfo(null);
      return null as any;
    }
    const info = {
      status: row.status ? String(row.status) : null,
      last_sync_at: row.last_sync_at ? String(row.last_sync_at) : null,
    };
    setConnectionInfo(info);
    return info;
  }

  async function loadTransactions() {
    if (!businessId) {
      setRows([]);
      return [] as any;
    }
    const res = await supabase
      .from('bank_transactions')
      .select(
        'id,posted_at,amount,currency,merchant_name,description,tx_category_id,category_source,confidence,needs_review,created_at'
      )
      .eq('business_id', businessId)
      .order('posted_at', { ascending: false })
      .limit(100);
    if (res.error) throw res.error;
    const list = (res.data as any[]) as BankTx[];
    setRows(list);
    return list;
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      if (!businessId) {
        setRows([]);
        setCategories([]);
        setConnectionInfo(null);
        setShowDemo(false);
        return;
      }
      await loadCategories();
      const info = await loadConnectionInfo();
      const tx = await loadTransactions();
      setShowDemo(Boolean(!info && (tx?.length ?? 0) === 0));
    } catch (e: any) {
      setError(String(e?.message ?? 'Failed to load bank feed.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  async function importMock() {
    if (!businessId) return;
    setImporting(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? null;
      if (!token) throw new Error('Please sign in again.');

      const res = await fetch('/api/transactions/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ businessId }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(String(json?.error ?? 'Import failed.'));

      pushToast({ tone: 'ok', message: `Imported ${Number(json?.imported ?? 0)} transactions.` });
      await loadTransactions();
    } catch (e: any) {
      setError(String(e?.message ?? 'Import failed.'));
    } finally {
      setImporting(false);
    }
  }

  async function saveCategory(tx: BankTx) {
    if (!businessId || !userId) return;
    const nextCat = pendingCategory[tx.id] ?? '';
    if (!nextCat) return;

    setError(null);
    try {
      const res = await fetch('/api/transactions/set-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          transaction_id: tx.id,
          category_id: nextCat,
          applyFuture: Boolean(applyRule[tx.id]),
        }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(String(json?.error ?? 'Failed to save.'));

      setRows((prev) =>
        prev.map((r) =>
          r.id === tx.id
            ? {
                ...r,
                tx_category_id: nextCat,
                category_source: 'user',
                confidence: 1.0,
                needs_review: false,
              }
            : r
        )
      );
      setPendingCategory((prev) => {
        const c = { ...prev };
        delete c[tx.id];
        return c;
      });
      setApplyRule((prev) => ({ ...prev, [tx.id]: false }));
      pushToast({ tone: 'ok', message: 'Saved.' });
    } catch (e: any) {
      setError(String(e?.message ?? 'Failed to save.'));
    }
  }

  async function connectStripeFc() {
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
      if (typeof collect !== 'function') {
        throw new Error('Stripe.js does not support Financial Connections in this build.');
      }

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
      await loadConnectionInfo();
      await loadTransactions();
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
      await loadConnectionInfo();
      await loadTransactions();
    } catch (e: any) {
      setError(String(e?.message ?? 'Sync failed.'));
    } finally {
      setSyncing(false);
    }
  }

  if (!userId) {
    return (
      <section className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-5">
        <div className="text-sm font-semibold text-slate-100">Bank feed (MVP)</div>
        <div className="mt-2 text-sm text-slate-300">Sign in to view your bank feed.</div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4 shadow-[0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="text-sm font-semibold text-slate-100">Bank feed (MVP)</div>
          <div className="text-xs text-slate-400">
            Phase 1: Stripe Financial Connections + rules/default categorization. {/* TODO(Phase2): cron, webhooks, presets, splits */}
          </div>
          {showDemo ? (
            <div className="mt-1 inline-flex w-fit items-center rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold text-indigo-200">
              Demo Data
            </div>
          ) : null}
          <div className="text-[11px] text-slate-400">
            {connectionInfo ? (
              <>
                Status: <span className="text-slate-200">{connectionInfo.status ?? '—'}</span>
                {connectionInfo.last_sync_at ? (
                  <>
                    {' '}
                    · Last sync: <span className="text-slate-200">{timeAgo(connectionInfo.last_sync_at)}</span>
                  </>
                ) : null}
              </>
            ) : (
              <>No bank connected yet.</>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <label className="inline-flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={needsReviewOnly}
              onChange={(e) => setNeedsReviewOnly(e.target.checked)}
            />
            Needs review
          </label>
          <button
            type="button"
            onClick={() => void connectStripeFc()}
            disabled={!businessId || connecting}
            className={
              'inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-semibold transition ' +
              (connecting
                ? 'bg-slate-800 text-slate-400 cursor-not-allowed'
                : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400')
            }
          >
            {connecting ? 'Connecting…' : 'Connect bank'}
          </button>
          <button
            type="button"
            onClick={() => void syncNow()}
            disabled={!businessId || syncing || !connectionInfo}
            className={
              'inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-semibold transition ' +
              (syncing || !connectionInfo
                ? 'bg-slate-800 text-slate-400 cursor-not-allowed'
                : 'bg-white/10 text-slate-100 hover:bg-white/15')
            }
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <button
            type="button"
            onClick={importMock}
            disabled={!businessId || importing}
            className={
              'inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-semibold transition ' +
              (importing
                ? 'bg-slate-800 text-slate-400 cursor-not-allowed'
                : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400')
            }
          >
            {importing ? 'Importing…' : 'Import sample transactions'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[64px] rounded-xl border border-white/10 bg-white/5 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-5 text-sm text-slate-300">
          No bank transactions yet.
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
          <table className="min-w-full text-[11px]">
            <thead className="bg-slate-900/60 text-slate-300">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Merchant</th>
                <th className="px-3 py-2 text-left hidden sm:table-cell">Description</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">Review</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tx) => {
                const current = tx.tx_category_id ?? '';
                const pending = pendingCategory[tx.id] ?? '';
                const isDirty = Boolean(pending) && pending !== current;
                const merchant = String(tx.merchant_name ?? '').trim() || '—';
                return (
                  <tr
                    key={tx.id}
                    className={
                      'border-t border-white/10 hover:bg-white/5 ' +
                      (tx.needs_review ? 'bg-amber-500/5' : 'bg-transparent')
                    }
                  >
                    <td className="px-3 py-2 text-slate-200 whitespace-nowrap">{tx.posted_at}</td>
                    <td className="px-3 py-2 text-slate-100">
                      <div className="font-semibold">{merchant}</div>
                      <div className="text-[10px] text-slate-400">{timeAgo(tx.created_at)}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-300 hidden sm:table-cell">
                      {String(tx.description ?? '')}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <select
                          value={pending || current}
                          onChange={(e) =>
                            setPendingCategory((prev) => ({ ...prev, [tx.id]: e.target.value }))
                          }
                          className="rounded-lg border border-white/10 bg-slate-950/40 px-2 py-1 text-[11px] text-slate-100"
                        >
                          <option value="" disabled>
                            Select…
                          </option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        {isDirty ? (
                          <>
                            <label className="hidden md:inline-flex items-center gap-1 text-[10px] text-slate-300">
                              <input
                                type="checkbox"
                                checked={Boolean(applyRule[tx.id])}
                                onChange={(e) =>
                                  setApplyRule((prev) => ({ ...prev, [tx.id]: e.target.checked }))
                                }
                              />
                              Apply to future
                            </label>
                            <button
                              type="button"
                              onClick={() => void saveCategory(tx)}
                              className="rounded-lg bg-emerald-500 px-2 py-1 text-[11px] font-semibold text-slate-950 hover:bg-emerald-400"
                            >
                              Save
                            </button>
                          </>
                        ) : (
                          <div className="text-[10px] text-slate-400">
                            {tx.category_source} • {Number(tx.confidence ?? 0).toFixed(1)}
                          </div>
                        )}
                      </div>
                      {isDirty ? (
                        <div className="mt-1 md:hidden text-[10px] text-slate-300">
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={Boolean(applyRule[tx.id])}
                              onChange={(e) =>
                                setApplyRule((prev) => ({ ...prev, [tx.id]: e.target.checked }))
                              }
                            />
                            Apply to future from this merchant
                          </label>
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-100 whitespace-nowrap">
                      {formatCurrency(tx.amount)}
                    </td>
                    <td className="px-3 py-2">
                      {tx.needs_review ? (
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-100">
                          Needs review
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}


