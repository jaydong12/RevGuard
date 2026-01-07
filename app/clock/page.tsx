'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../utils/supabaseClient';
import { useToast } from '../../components/ToastProvider';

type ProfileRow = {
  id: string;
  role: 'owner' | 'employee' | string;
  business_id: string | null;
  worker_id: number | null;
};

type WorkerRow = {
  id: number;
  business_id: string;
  name: string;
  role: string;
  is_active: boolean;
};

type BusinessClockSettings = {
  business_id: string;
  clock_in_start: string; // time
  clock_in_end: string; // time
  allowed_lat: number | null;
  allowed_lng: number | null;
  allowed_radius_m: number;
  enforce_clock_window?: boolean;
  enforce_geofence?: boolean;
  clock_shift_presets?: Array<{ label: string; start_hhmm: string }>;
};

type TimeEntry = {
  id: number;
  business_id: string;
  worker_id: number;
  clock_in_at: string;
  clock_out_at: string | null;
  clock_lat: number | null;
  clock_lng: number | null;
};

function safeDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

function fmtWhen(iso: string | null | undefined) {
  const d = safeDate(iso);
  if (!d) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function parseTimeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const s = String(t).trim();
  // Accept HH:MM or HH:MM:SS
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function formatHhmmTo12h(hhmm: string) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? '').trim());
  if (!m) return hhmm;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return hhmm;
  const ampm = hh >= 12 ? 'PM' : 'AM';
  let hour12 = hh % 12;
  if (hour12 === 0) hour12 = 12;
  return `${hour12}:${String(mm).padStart(2, '0')} ${ampm}`;
}

function inClockWindow(params: { now: Date; start: string; end: string }): boolean {
  const startMin = parseTimeToMinutes(params.start);
  const endMin = parseTimeToMinutes(params.end);
  if (startMin === null || endMin === null) return false;
  const cur = params.now.getHours() * 60 + params.now.getMinutes();
  if (startMin <= endMin) return cur >= startMin && cur <= endMin;
  // Overnight window (e.g., 22:00 -> 06:00)
  return cur >= startMin || cur <= endMin;
}

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function getGeolocation(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation is not available in this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(err?.message || 'Location permission denied.')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}

export default function ClockPage() {
  const router = useRouter();
  const { pushToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [membership, setMembership] = useState<{ business_id: string; role: string } | null>(null);
  const [worker, setWorker] = useState<WorkerRow | null>(null);
  const [settings, setSettings] = useState<BusinessClockSettings | null>(null);
  const [selectedShift, setSelectedShift] = useState<{ label: string; start_hhmm: string } | null>(null);
  const [openEntry, setOpenEntry] = useState<TimeEntry | null>(null);
  const [recent, setRecent] = useState<TimeEntry[]>([]);
  const [locationVerified, setLocationVerified] = useState(false);
  const [acting, setActing] = useState(false);

  const statusLabel = useMemo(() => {
    if (!worker) return '—';
    if (!worker.is_active) return 'Inactive';
    return openEntry ? 'Clocked In' : 'Clocked Out';
  }, [worker, openEntry]);

  const shiftPresets = useMemo(() => {
    const raw = (settings?.clock_shift_presets ?? []) as any[];
    return raw
      .map((x) => ({
        label: String((x as any)?.label ?? '').trim(),
        start_hhmm: String((x as any)?.start_hhmm ?? '').trim(),
      }))
      .filter((x) => x.label && x.start_hhmm);
  }, [settings?.clock_shift_presets]);

  async function load() {
    setLoading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user?.id ?? null;
      if (!userId) {
        router.replace('/login?redirect=/clock');
        return;
      }

      const { data: bm, error: bmErr } = await supabase
        .from('business_members')
        .select('business_id, role')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (bmErr) throw bmErr;
      const bmr = (bm as any) ?? null;
      const role = String(bmr?.role ?? '').toLowerCase();
      const businessId = String(bmr?.business_id ?? '').trim();
      if (!businessId) {
        throw new Error('No business membership found. Ask your owner to invite you.');
      }
      if (role !== 'employee') {
        router.replace('/workers');
        return;
      }
      setMembership({ business_id: businessId, role });

      const { data: bs, error: bsErr } = await supabase
        .from('business_settings')
        .select('business_id, clock_in_start, clock_in_end, allowed_lat, allowed_lng, allowed_radius_m, enforce_clock_window, enforce_geofence, clock_shift_presets')
        .eq('business_id', businessId)
        .maybeSingle();
      if (bsErr) throw bsErr;
      const s = (bs ?? null) as any;
      setSettings({
        business_id: String(s?.business_id ?? businessId),
        clock_in_start: String(s?.clock_in_start ?? '05:00'),
        clock_in_end: String(s?.clock_in_end ?? '23:00'),
        allowed_lat: s?.allowed_lat === null || s?.allowed_lat === undefined ? null : Number(s.allowed_lat),
        allowed_lng: s?.allowed_lng === null || s?.allowed_lng === undefined ? null : Number(s.allowed_lng),
        allowed_radius_m: Number(s?.allowed_radius_m ?? 250) || 250,
        enforce_clock_window: s?.enforce_clock_window === null || s?.enforce_clock_window === undefined ? true : Boolean(s.enforce_clock_window),
        enforce_geofence: s?.enforce_geofence === null || s?.enforce_geofence === undefined ? false : Boolean(s.enforce_geofence),
        clock_shift_presets: Array.isArray(s?.clock_shift_presets) ? (s.clock_shift_presets as any[]) : [],
      });

      const { data: w, error: wErr } = await supabase
        .from('workers')
        .select('id,business_id,name,role,is_active')
        .eq('business_id', businessId)
        .eq('user_id', userId)
        .maybeSingle();
      if (wErr) throw wErr;
      if (!w?.id) throw new Error('Worker record not found.');
      setWorker({
        id: Number(w.id),
        business_id: String(w.business_id),
        name: String(w.name ?? ''),
        role: String(w.role ?? ''),
        is_active: Boolean((w as any).is_active),
      });

      const { data: open, error: openErr } = await supabase
        .from('time_entries')
        .select('id,business_id,worker_id,clock_in_at,clock_out_at,clock_lat,clock_lng')
        .eq('business_id', businessId)
        .eq('worker_id', Number(w.id))
        .is('clock_out_at', null)
        .order('clock_in_at', { ascending: false })
        .limit(1);
      if (openErr) throw openErr;
      setOpenEntry((open?.[0] as any) ?? null);

      const { data: rec, error: recErr } = await supabase
        .from('time_entries')
        .select('id,business_id,worker_id,clock_in_at,clock_out_at,clock_lat,clock_lng')
        .eq('business_id', businessId)
        .eq('worker_id', Number(w.id))
        .order('clock_in_at', { ascending: false })
        .limit(12);
      if (recErr) throw recErr;
      setRecent((rec ?? []) as any);

      setSelectedShift(null);
      setLocationVerified(false);
    } catch (e: any) {
      pushToast({ tone: 'error', message: String(e?.message ?? 'Failed to load clock.') });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function validateClockRestrictions(): Promise<{ lat: number; lng: number }> {
    const s = settings;
    if (!s) throw new Error('Clock settings not loaded yet.');

    const now = new Date();
    if (s.enforce_clock_window !== false) {
      const okTime = inClockWindow({ now, start: s.clock_in_start, end: s.clock_in_end });
      if (!okTime) {
        throw new Error(`Clocking is only allowed between ${s.clock_in_start} and ${s.clock_in_end} (local time).`);
      }
    }

    const loc = await getGeolocation();
    if (s.enforce_geofence !== false) {
      if (s.allowed_lat === null || s.allowed_lng === null) {
        throw new Error('Location is not configured for this business. Ask your owner to set it in Workers.');
      }

      const dist = haversineMeters(
        { lat: s.allowed_lat, lng: s.allowed_lng },
        { lat: loc.lat, lng: loc.lng }
      );
      if (dist > s.allowed_radius_m) {
        throw new Error(
          `You are outside the allowed clock-in area (${Math.round(dist)}m away; limit ${s.allowed_radius_m}m).`
        );
      }
    }

    setLocationVerified(true);
    return loc;
  }

  async function doClock(params?: { shift?: { label: string; start_hhmm: string } | null }) {
    if (!membership?.business_id || !worker?.id) return;
    if (!worker?.is_active) {
      pushToast({ tone: 'error', message: 'This worker is inactive.' });
      return;
    }
    setActing(true);
    try {
      const loc = await validateClockRestrictions();
      const nowIso = new Date().toISOString();

      if (!openEntry) {
        const payload: any = {
          business_id: membership.business_id,
          worker_id: worker.id,
          clock_in_at: nowIso,
          clock_out_at: null,
          clock_lat: loc.lat,
          clock_lng: loc.lng,
          notes: null,
          shift_label: params?.shift?.label ?? null,
          shift_start_hhmm: params?.shift?.start_hhmm ?? null,
        };
        const { error } = await supabase.from('time_entries').insert(payload);
        if (error) throw error;
        pushToast({ tone: 'ok', message: 'Clocked in.' });
      } else {
        const { error } = await supabase
          .from('time_entries')
          .update({ clock_out_at: nowIso, clock_lat: loc.lat, clock_lng: loc.lng } as any)
          .eq('id', openEntry.id)
          .eq('business_id', membership.business_id);
        if (error) throw error;
        pushToast({ tone: 'ok', message: 'Clocked out.' });
      }

      await load();
    } catch (e: any) {
      pushToast({ tone: 'error', message: String(e?.message ?? 'Clock action failed.') });
    } finally {
      setActing(false);
    }
  }

  return (
    <main className="space-y-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Employee Clock</h1>
        <p className="text-slate-400 text-sm">
          Clock yourself in/out. Times are recorded automatically—no manual edits.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Worker</div>
            <div className="mt-1 text-lg font-semibold text-slate-100">
              {worker?.name ?? (loading ? 'Loading…' : '—')}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              Status: <span className="text-slate-200">{statusLabel}</span>
              {openEntry?.clock_in_at ? ` • Last clock in: ${fmtWhen(openEntry.clock_in_at)}` : ''}
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              {locationVerified ? (
                <span className="text-emerald-200">Location verified</span>
              ) : (
                <span className="text-slate-400">Location will be verified on clock in/out</span>
              )}
            </div>
          </div>

          {openEntry ? (
            <button
              type="button"
              disabled={loading || acting || !worker?.is_active}
              onClick={() => void doClock()}
              className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-5 py-4 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {acting ? 'Working…' : 'Clock Out'}
            </button>
          ) : shiftPresets.length > 0 ? (
            <div className="flex flex-col gap-2 items-end">
              <div className="text-[10px] uppercase tracking-wide text-slate-500 text-right">Pick a shift</div>
              <div className="grid gap-2">
                {shiftPresets.map((p) => {
                  const isSelected = selectedShift?.label === p.label && selectedShift?.start_hhmm === p.start_hhmm;
                  return (
                    <button
                      key={`${p.label}:${p.start_hhmm}`}
                      type="button"
                      disabled={loading || acting || !worker?.is_active}
                      onClick={() => {
                        setSelectedShift(p);
                        void doClock({ shift: p });
                      }}
                      className={`rounded-2xl border px-5 py-3 text-left text-sm font-semibold disabled:opacity-50 ${
                        isSelected
                          ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-100'
                          : 'border-white/10 bg-white/5 text-slate-100 hover:bg-white/10'
                      }`}
                    >
                      <div>{p.label}</div>
                      <div className="mt-1 text-[11px] font-normal text-slate-400">
                        Starts {formatHhmmTo12h(p.start_hhmm)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={loading || acting || !worker?.is_active}
              onClick={() => void doClock()}
              className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-5 py-4 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {acting ? 'Working…' : 'Clock In'}
            </button>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5">
        <div className="text-[10px] uppercase tracking-wide text-slate-500">Recent entries</div>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03]">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-950/60 text-[11px] text-slate-400">
              <tr>
                <th className="text-left px-4 py-3">Clock in</th>
                <th className="text-left px-4 py-3">Clock out</th>
              </tr>
            </thead>
            <tbody>
              {(recent ?? []).length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-[11px] text-slate-400" colSpan={2}>
                    No time entries yet.
                  </td>
                </tr>
              ) : (
                recent.map((e) => (
                  <tr key={e.id} className="border-t border-white/10">
                    <td className="px-4 py-3 text-slate-200">{fmtWhen(e.clock_in_at)}</td>
                    <td className="px-4 py-3 text-slate-300">{fmtWhen(e.clock_out_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}


