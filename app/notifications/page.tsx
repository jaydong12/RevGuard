'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../utils/supabaseClient';
import { useAppData } from '../../components/AppDataProvider';

export default function NotificationsPage() {
  const router = useRouter();
  const { businessId, loading: appLoading } = useAppData();

  type Filter = 'unread' | 'all' | 'history';
  const [filter, setFilter] = React.useState<Filter>('unread');
  const [historyDays, setHistoryDays] = React.useState<7 | 14 | 30>(14);

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  type NotificationRow = {
    id: string;
    business_id: string;
    created_at: string;
    kind: string | null;
    group_key: string | null;
    title: string;
    body: string | null;
    action_url: string | null;
    read_at: string | null;
    dismissed_at: string | null;
  };

  const [rows, setRows] = React.useState<NotificationRow[]>([]);

  const nowIso = React.useMemo(() => new Date().toISOString(), []);

  function isActive(n: NotificationRow) {
    return !n.dismissed_at;
  }
  function isUnread(n: NotificationRow) {
    return !n.read_at && isActive(n);
  }

  const visibleRows = React.useMemo(() => {
    const all = (rows ?? []).filter((n) => n.business_id && businessId && n.business_id === businessId);

    const active = all.filter(isActive);
    if (filter === 'unread') {
      return active.filter((n) => !n.read_at);
    }

    if (filter === 'all') {
      return active;
    }

    // history: read items only, last N days, not dismissed
    const since = new Date();
    since.setDate(since.getDate() - historyDays);
    const sinceMs = since.getTime();
    return active.filter((n) => {
      if (!n.read_at) return false;
      const t = new Date(n.read_at).getTime();
      return Number.isFinite(t) ? t >= sinceMs : false;
    });
  }, [rows, businessId, filter, historyDays]);

  type Group = {
    key: string;
    kind: string;
    count: number;
    newest: NotificationRow;
    ids: string[];
    unreadCount: number;
  };

  const grouped = React.useMemo(() => {
    const map = new Map<string, Group>();
    for (const n of visibleRows) {
      const kind = String(n.kind ?? 'other').trim().toLowerCase() || 'other';
      const key = String(n.group_key ?? '').trim() || kind;
      const g = map.get(key);
      if (!g) {
        map.set(key, {
          key,
          kind,
          count: 1,
          newest: n,
          ids: [n.id],
          unreadCount: n.read_at ? 0 : 1,
        });
      } else {
        g.count += 1;
        g.ids.push(n.id);
        if (!n.read_at) g.unreadCount += 1;
        if (new Date(n.created_at).getTime() > new Date(g.newest.created_at).getTime()) {
          g.newest = n;
        }
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.newest.created_at).getTime() - new Date(a.newest.created_at).getTime()
    );
  }, [visibleRows]);

  function summaryTitle(g: Group) {
    const k = g.kind;
    if (g.count <= 1) return g.newest.title;
    if (k === 'bills') return `${g.count} bill alerts`;
    if (k === 'bookings') return `${g.count} booking updates`;
    if (k === 'workers') return `${g.count} worker updates`;
    return `${g.count} notifications`;
  }

  function formatRelative(iso: string) {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const diff = Date.now() - t;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `${days}d`;
  }

  async function load() {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const q = supabase
        .from('notifications')
        .select('id,business_id,created_at,kind,group_key,title,body,action_url,read_at,dismissed_at')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(200);
      const res = await q;
      if (res.error) throw res.error;
      setRows(((res.data as any[]) ?? []) as NotificationRow[]);
    } catch (e: any) {
      setError(String(e?.message ?? 'Could not load notifications.'));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  // Realtime: new alerts appear instantly.
  React.useEffect(() => {
    if (!businessId) return;
    const channel = supabase
      .channel(`notifications_${businessId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `business_id=eq.${businessId}` },
        (payload: any) => {
          const type = String(payload?.eventType ?? '').toUpperCase();
          if (type === 'INSERT') {
            const n = payload.new as NotificationRow;
            setRows((prev) => [n, ...prev].slice(0, 250));
            return;
          }
          if (type === 'UPDATE') {
            const n = payload.new as NotificationRow;
            setRows((prev) => prev.map((x) => (x.id === n.id ? { ...x, ...n } : x)));
            return;
          }
          if (type === 'DELETE') {
            const oldId = String((payload.old as any)?.id ?? '');
            if (!oldId) return;
            setRows((prev) => prev.filter((x) => x.id !== oldId));
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [businessId]);

  async function markGroupReadAndGo(g: Group) {
    const url = String(g.newest.action_url ?? '').trim();

    // Optimistic: remove from list immediately (default filter hides read anyway).
    setRows((prev) =>
      prev.map((x) => (g.ids.includes(x.id) ? { ...x, read_at: x.read_at ?? nowIso } : x))
    );

    try {
      await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() } as any)
        .in('id', g.ids)
        .is('read_at', null);
    } catch {
      // ignore; realtime or next refresh will reconcile
    }

    // Remove from list so the feed stays calm.
    setRows((prev) => prev.filter((x) => !g.ids.includes(x.id) || x.read_at));

    if (url) router.push(url);
  }

  async function markAllAsRead() {
    if (!businessId) return;
    const ids = visibleRows.filter((n) => !n.read_at).map((n) => n.id);
    if (ids.length === 0) return;

    setRows((prev) => prev.map((x) => (ids.includes(x.id) ? { ...x, read_at: x.read_at ?? nowIso } : x)));
    try {
      await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() } as any)
        .eq('business_id', businessId)
        .is('dismissed_at', null)
        .is('read_at', null);
    } catch {
      // ignore
    }
  }

  async function clearAll() {
    if (!businessId) return;
    const ids = visibleRows.map((n) => n.id);
    if (ids.length === 0) return;

    setRows((prev) => prev.map((x) => (ids.includes(x.id) ? { ...x, dismissed_at: x.dismissed_at ?? nowIso } : x)));
    try {
      await supabase
        .from('notifications')
        .update({ dismissed_at: new Date().toISOString() } as any)
        .eq('business_id', businessId)
        .is('dismissed_at', null);
    } catch {
      // ignore
    }
  }

  return (
    <main className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-sm text-slate-400">A calm feed of what needs your attention.</p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {([
            { key: 'unread', label: 'Unread' },
            { key: 'all', label: 'All' },
            { key: 'history', label: 'History' },
          ] as const).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilter(t.key)}
              className={`px-3 py-1.5 rounded-full text-xs border ${
                filter === t.key
                  ? 'bg-emerald-500 text-slate-950 border-emerald-500'
                  : 'bg-slate-900 text-slate-200 border-slate-700 hover:bg-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}

          {filter === 'history' ? (
            <select
              value={historyDays}
              onChange={(e) => setHistoryDays(Number(e.target.value) as any)}
              className="ml-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200"
              aria-label="History range"
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
            </select>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={markAllAsRead}
            className="rounded-full border border-slate-700 bg-slate-950/40 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-900/60"
          >
            Mark all as read
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="rounded-full border border-slate-700 bg-slate-950/40 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-900/60"
          >
            Clear all
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-800 bg-slate-950/40 overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="text-xs text-slate-400">
            {appLoading || loading ? 'Loading…' : `${grouped.length} items`}
          </div>
          <button
            type="button"
            onClick={() => load()}
            className="text-xs text-slate-300 hover:text-slate-100"
          >
            Refresh
          </button>
        </div>

        {(!businessId || grouped.length === 0) && !loading ? (
          <div className="p-5">
            <div className="text-sm font-semibold text-slate-100">You’re all caught up.</div>
            <div className="mt-2 text-sm text-slate-300 leading-relaxed">
              New alerts will appear here as they happen.
            </div>
          </div>
        ) : null}

        {grouped.length > 0 ? (
          <ul className="divide-y divide-slate-800">
            {grouped.map((g) => (
              <li key={g.key}>
                <button
                  type="button"
                  onClick={() => void markGroupReadAndGo(g)}
                  className="w-full text-left px-4 py-4 hover:bg-slate-900/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-100 truncate">
                        {summaryTitle(g)}
                      </div>
                      {g.count === 1 && g.newest.body ? (
                        <div className="mt-1 text-xs text-slate-400 line-clamp-2">
                          {g.newest.body}
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-slate-400">
                          {g.unreadCount > 0 ? `${g.unreadCount} unread` : 'Read'}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      {g.unreadCount > 0 ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-200">
                          Unread
                        </span>
                      ) : null}
                      <div className="text-[11px] text-slate-500">
                        {formatRelative(g.newest.created_at)}
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </main>
  );
}


