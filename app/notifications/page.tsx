'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../utils/supabaseClient';
import { useAppData } from '../../components/AppDataProvider';

export default function NotificationsPage() {
  const router = useRouter();
  const { businessId, userId } = useAppData();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Array<any>>([]);
  const [actingAll, setActingAll] = useState(false);
  const [subtleToast, setSubtleToast] = useState<string | null>(null);

  const active = useMemo(() => items.filter((n) => !n.dismissed_at), [items]);

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

  function severityDot(sev: string | null | undefined) {
    const s = String(sev ?? 'info').toLowerCase();
    if (s === 'critical' || s === 'error' || s === 'high') return 'bg-rose-400';
    if (s === 'warning' || s === 'medium') return 'bg-amber-300';
    if (s === 'success') return 'bg-emerald-300';
    return 'bg-slate-400';
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      if (!businessId) {
        setItems([]);
        setLoading(false);
        return;
      }

      const res = await supabase
        .from('notifications')
        .select('id,business_id,user_id,type,title,body,action_url,severity,is_read,dismissed_at,created_at')
        .eq('business_id', businessId)
        .is('dismissed_at', null)
        .order('created_at', { ascending: false })
        .limit(100);

      if (res.error) throw res.error;
      setItems((res.data as any[]) ?? []);
    } catch (e: any) {
      setError(String(e?.message ?? 'Failed to load notifications.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;

    const channel = supabase
      .channel(`notifications:${businessId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `business_id=eq.${businessId}` },
        (payload) => {
          const row: any = payload?.new ?? payload?.old ?? null;
          if (!row?.id) return;

          setItems((prev) => {
            const idx = prev.findIndex((x) => String(x.id) === String(row.id));
            const dismissed = row.dismissed_at !== null && row.dismissed_at !== undefined;

            if (payload.eventType === 'INSERT') {
              if (dismissed) return prev;
              const next = [row, ...prev.filter((x) => String(x.id) !== String(row.id))];
              return next.slice(0, 100);
            }

            if (payload.eventType === 'UPDATE') {
              if (dismissed) return prev.filter((x) => String(x.id) !== String(row.id));
              if (idx === -1) return [row, ...prev].slice(0, 100);
              const copy = prev.slice();
              copy[idx] = { ...copy[idx], ...row };
              return copy;
            }

            return prev;
          });

          if (payload.eventType === 'INSERT') {
            setSubtleToast('New notification');
            window.setTimeout(() => setSubtleToast(null), 1800);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [businessId]);

  async function markRead(id: string) {
    setItems((prev) => prev.map((n) => (String(n.id) === String(id) ? { ...n, is_read: true } : n)));
    const { error } = await supabase.from('notifications').update({ is_read: true } as any).eq('id', id);
    if (error) setError(error.message ?? 'Failed to mark read.');
  }

  async function dismiss(id: string) {
    const now = new Date().toISOString();
    setItems((prev) => prev.filter((n) => String(n.id) !== String(id)));
    const { error } = await supabase.from('notifications').update({ dismissed_at: now } as any).eq('id', id);
    if (error) setError(error.message ?? 'Failed to dismiss.');
  }

  async function markAllRead() {
    if (!businessId) return;
    setActingAll(true);
    setError(null);
    try {
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true } as any)
        .eq('business_id', businessId)
        .is('dismissed_at', null);
      if (error) throw error;
    } catch (e: any) {
      setError(String(e?.message ?? 'Failed to mark all as read.'));
    } finally {
      setActingAll(false);
    }
  }

  async function clearAll() {
    if (!businessId) return;
    setActingAll(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      setItems([]);
      const { error } = await supabase
        .from('notifications')
        .update({ dismissed_at: now } as any)
        .eq('business_id', businessId)
        .is('dismissed_at', null);
      if (error) throw error;
    } catch (e: any) {
      setError(String(e?.message ?? 'Failed to clear notifications.'));
    } finally {
      setActingAll(false);
    }
  }

  if (!userId) {
    return (
      <main className="min-h-[calc(100vh-80px)] flex flex-col">
        <div className="mx-auto w-full max-w-4xl flex flex-col flex-1 space-y-6">
          <header className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
            <p className="text-sm text-slate-400">Sign in to view your notifications.</p>
          </header>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5 text-sm text-slate-300">
            You’re not signed in.
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-80px)] flex flex-col">
      <div className="mx-auto w-full max-w-4xl flex flex-col flex-1 space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
            <p className="text-sm text-slate-400">Updates for your workspace.</p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              disabled={actingAll || active.length === 0}
              onClick={markAllRead}
              className={
                'rounded-xl border px-3 py-2 text-xs font-semibold transition ' +
                (actingAll || active.length === 0
                  ? 'border-slate-800 bg-slate-900/40 text-slate-500 cursor-not-allowed'
                  : 'border-slate-800 bg-slate-950/40 text-slate-200 hover:bg-slate-900/60')
              }
            >
              Mark all read
            </button>
            <button
              type="button"
              disabled={actingAll || active.length === 0}
              onClick={clearAll}
              className={
                'rounded-xl px-3 py-2 text-xs font-semibold transition ' +
                (actingAll || active.length === 0
                  ? 'text-slate-500 cursor-not-allowed'
                  : 'text-rose-200 hover:text-rose-100')
              }
            >
              Clear all
            </button>
          </div>
        </header>

        {subtleToast ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-xs text-slate-200">
            {subtleToast}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="w-full space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-[92px] rounded-xl border border-slate-800 bg-slate-950/40 animate-pulse"
              />
            ))}
          </div>
        ) : active.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="max-w-xl w-full rounded-2xl border border-slate-800 bg-slate-950/40 p-8 text-center">
              <div className="text-sm font-semibold text-slate-100">You’re all caught up.</div>
              <div className="mt-2 text-sm text-slate-300 leading-relaxed">
                New notifications will appear here as your workspace updates.
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full space-y-3">
            {active.map((n) => {
              const unread = !Boolean(n.is_read);
              return (
                <div
                  key={String(n.id)}
                  role="button"
                  tabIndex={0}
                  onClick={() => void markRead(String(n.id))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') void markRead(String(n.id));
                  }}
                  className={
                    'rounded-xl border p-4 transition hover:-translate-y-[1px] hover:bg-slate-900/30 cursor-pointer ' +
                    (unread
                      ? 'border-slate-700 bg-slate-950/55'
                      : 'border-slate-800 bg-slate-950/40')
                  }
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex items-start gap-3">
                      <div className={`mt-1.5 h-2 w-2 rounded-full ${severityDot(n.severity)}`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-semibold text-slate-100 truncate">
                            {String(n.title ?? 'Notification')}
                          </div>
                          {unread ? (
                            <div className="rounded-full border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-[10px] font-semibold text-slate-200">
                              Unread
                            </div>
                          ) : null}
                        </div>
                        <div className="mt-1 text-sm text-slate-300 leading-relaxed line-clamp-2">
                          {String(n.body ?? '')}
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 flex flex-col items-end gap-2">
                      <div className="text-[11px] text-slate-400">{timeAgo(String(n.created_at))}</div>
                      <div className="flex items-center gap-2">
                        {n.action_url ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void markRead(String(n.id));
                              router.push(String(n.action_url));
                            }}
                            className="rounded-lg border border-slate-800 bg-slate-950/30 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-900/60"
                          >
                            Open
                          </button>
                        ) : null}
                        <button
                          type="button"
                          aria-label="Dismiss"
                          onClick={(e) => {
                            e.stopPropagation();
                            void dismiss(String(n.id));
                          }}
                          className="rounded-lg border border-slate-800 bg-slate-950/20 px-2 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-900/60"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}


