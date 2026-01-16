'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../utils/supabaseClient';

type WorkerRow = {
  id: number;
  business_id: string;
  name: string;
  is_active: boolean;
  email?: string;
};

type TimeEntryRow = {
  id: number;
  business_id: string;
  worker_id: number;
  clock_in_at: string;
  clock_out_at: string | null;
};

function safeDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

function fmtTime(iso: string | null | undefined) {
  const d = safeDate(iso);
  if (!d) return '—';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function hoursBetween(startIso: string, endIso: string | null) {
  const a = safeDate(startIso);
  const b = safeDate(endIso) ?? new Date();
  if (!a) return 0;
  const ms = b.getTime() - a.getTime();
  return Math.max(0, ms / 36e5);
}

function clearAuthCookie() {
  try {
    document.cookie = `rg_at=; Path=/; Max-Age=0; SameSite=Lax`;
  } catch {
    // ignore
  }
}

export default function EmployeeClockPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [worker, setWorker] = useState<WorkerRow | null>(null);
  const [openEntry, setOpenEntry] = useState<TimeEntryRow | null>(null);
  const [todayEntries, setTodayEntries] = useState<TimeEntryRow[]>([]);
  const lastActionAtRef = useRef<number>(0);

  const todayHours = useMemo(() => {
    return (todayEntries ?? []).reduce((sum, e) => sum + hoursBetween(e.clock_in_at, e.clock_out_at), 0);
  }, [todayEntries]);

  const status = openEntry ? 'Clocked In' : 'Clocked Out';

  async function apiFetchJson(path: string, init?: RequestInit) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? null;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as any)) headers[k] = String(v);
    }
    const res = await fetch(path, { ...init, headers, cache: 'no-store' });
    const json = (await res.json().catch(() => ({}))) as any;
    return { res, json };
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { res, json } = await apiFetchJson('/api/employee/state');
      if (res.status === 401) {
        router.replace('/login?next=/employee/clock');
        return;
      }
      if (!res.ok) {
        throw new Error(String(json?.error ?? 'Could not load clock.'));
      }
      setWorker((json?.worker as WorkerRow) ?? null);
      setOpenEntry((json?.openEntry as TimeEntryRow) ?? null);
      setTodayEntries(((json?.entries as any[]) ?? []) as TimeEntryRow[]);
    } catch (e: any) {
      setError(String(e?.message ?? 'Could not load clock.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function clockIn() {
    if (!worker || acting) return;
    if (openEntry) return;
    const now = Date.now();
    if (now - lastActionAtRef.current < 700) return;
    lastActionAtRef.current = now;
    setActing(true);
    setError(null);
    try {
      const { res, json } = await apiFetchJson('/api/employee/clock-in', { method: 'POST' });
      if (!res.ok) throw new Error(String(json?.error ?? 'Could not clock in.'));
      await load();
    } catch (e: any) {
      setError(String(e?.message ?? 'Could not clock in.'));
    } finally {
      setActing(false);
    }
  }

  async function clockOut() {
    if (!worker || acting) return;
    if (!openEntry) return;
    const now = Date.now();
    if (now - lastActionAtRef.current < 700) return;
    lastActionAtRef.current = now;
    setActing(true);
    setError(null);
    try {
      const { res, json } = await apiFetchJson('/api/employee/clock-out', { method: 'POST' });
      if (!res.ok) throw new Error(String(json?.error ?? 'Could not clock out.'));
      await load();
    } catch (e: any) {
      setError(String(e?.message ?? 'Could not clock out.'));
    } finally {
      setActing(false);
    }
  }

  async function logout() {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    clearAuthCookie();
    router.replace('/login');
  }

  if (!loading && !worker) {
    return (
      <main className="min-h-[calc(100vh-80px)] flex items-center justify-center px-4">
        <div className="w-full max-w-xl">
          <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 backdrop-blur-sm p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/60 text-slate-200">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="h-6 w-6"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M12 7v5l3 2"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Not invited / not linked</h1>
            <p className="mt-2 text-base text-slate-300 leading-relaxed">
              This login isn’t linked to a worker yet. Ask your owner or manager to invite you using this exact email
              address, then try again.
            </p>
            <div className="mt-6 flex items-center justify-center">
              <button
                type="button"
                onClick={logout}
                className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-900/60"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-md mx-auto space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Clock</h1>
        <div className="text-xs font-semibold text-emerald-200">Employee Clock Works</div>
        <p className="text-sm text-slate-400">Employee time tracking</p>
      </header>

      {error ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="rounded-3xl border border-slate-800/80 bg-slate-950/45 backdrop-blur-sm p-5 space-y-3">
        {loading ? (
          <div className="text-sm text-slate-300">Loading…</div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-slate-500">Status</div>
                <div className="mt-1 text-lg font-semibold text-slate-100">{status}</div>
                {openEntry?.clock_in_at ? (
                  <div className="mt-1 text-xs text-slate-400">
                    Started at {fmtTime(openEntry.clock_in_at)}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={logout}
                className="shrink-0 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900/60"
              >
                Logout
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={clockIn}
                disabled={!worker || Boolean(openEntry) || acting}
                className={`rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                  !worker || Boolean(openEntry) || acting
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                }`}
              >
                Clock In
              </button>
              <button
                type="button"
                onClick={clockOut}
                disabled={!worker || !openEntry || acting}
                className={`rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                  !worker || !openEntry || acting
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    : 'bg-slate-100 text-slate-950 hover:bg-white'
                }`}
              >
                Clock Out
              </button>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="text-xs text-slate-500">Today’s hours</div>
              <div className="mt-1 text-xl font-semibold text-slate-100">
                {todayHours.toFixed(2)}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="text-xs text-slate-500">Today’s history</div>
              <div className="mt-2 space-y-2">
                {todayEntries.length === 0 ? (
                  <div className="text-sm text-slate-300">No entries yet.</div>
                ) : (
                  todayEntries.slice(0, 10).map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-800/70 bg-slate-950/30 px-3 py-2"
                    >
                      <div className="text-sm text-slate-200">
                        {fmtTime(e.clock_in_at)} → {e.clock_out_at ? fmtTime(e.clock_out_at) : 'Now'}
                      </div>
                      <div className="text-xs font-semibold text-slate-300">
                        {hoursBetween(e.clock_in_at, e.clock_out_at).toFixed(2)}h
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}


