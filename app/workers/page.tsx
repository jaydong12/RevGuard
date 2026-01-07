'use client';

import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../utils/supabaseClient';
import { useAppData } from '../../components/AppDataProvider';
import { formatCurrency } from '../../lib/formatCurrency';
import { useToast } from '../../components/ToastProvider';
import { Clock, UserCheck, Users } from 'lucide-react';

type Worker = {
  id: number;
  business_id: string;
  name: string;
  role: string;
  hourly_rate: number | null;
  is_active: boolean;
  created_at: string;
};

type TimeEntry = {
  id: number;
  business_id: string;
  worker_id: number;
  clock_in_at: string;
  clock_out_at: string | null;
  notes: string | null;
  created_at: string;
};

type BusinessClockSettings = {
  business_id: string;
  clock_in_start: string;
  clock_in_end: string;
  allowed_lat: number | null;
  allowed_lng: number | null;
  allowed_radius_m: number;
  clock_shift_presets: Array<{ label: string; start_hhmm: string }>;
};

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function hhmmTo12hParts(hhmm: string): { hour12: number; minute: number; ampm: 'AM' | 'PM' } {
  const [hhRaw, mmRaw] = String(hhmm ?? '').split(':');
  const hh = Number(hhRaw);
  const mm = Number(mmRaw);
  const safeHh = Number.isFinite(hh) ? Math.min(23, Math.max(0, hh)) : 5;
  const safeMm = Number.isFinite(mm) ? Math.min(59, Math.max(0, mm)) : 0;
  const ampm: 'AM' | 'PM' = safeHh >= 12 ? 'PM' : 'AM';
  let hour12 = safeHh % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour12, minute: safeMm, ampm };
}

function toHHMMFrom12h(hour12: number, minute: number, ampm: 'AM' | 'PM') {
  const h12 = Math.min(12, Math.max(1, Number(hour12) || 12));
  const mm = Math.min(59, Math.max(0, Number(minute) || 0));
  let hh24 = h12 % 12; // 12 -> 0
  if (ampm === 'PM') hh24 += 12;
  return `${pad2(hh24)}:${pad2(mm)}`;
}

function formatTime12h(hhmm: string) {
  const p = hhmmTo12hParts(hhmm);
  return `${p.hour12}:${pad2(p.minute)} ${p.ampm}`;
}

function formatClockWindow12h(startHHMM: string, endHHMM: string) {
  const s = hhmmTo12hParts(startHHMM);
  const e = hhmmTo12hParts(endHHMM);
  const start = `${s.hour12}:${pad2(s.minute)} ${s.ampm}`;
  const end = `${e.hour12}:${pad2(e.minute)} ${e.ampm}`;
  return `${start} – ${end}`;
}

function parseTime12hToHHMM(input: string): { hhmm: string | null; error: string | null } {
  const raw = String(input ?? '').trim();
  if (!raw) return { hhmm: null, error: 'Required.' };

  // Accept formats like: "6 AM", "6:00 AM", "11:30pm"
  const m = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!m) return { hhmm: null, error: 'Use a time like “6:00 AM”.' };

  const hour12 = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const ampm = String(m[3]).toUpperCase() as 'AM' | 'PM';

  if (!Number.isFinite(hour12) || hour12 < 1 || hour12 > 12) return { hhmm: null, error: 'Hour must be 1–12.' };
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return { hhmm: null, error: 'Minutes must be 00–59.' };

  return { hhmm: toHHMMFrom12h(hour12, minute, ampm), error: null };
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4 shadow-[0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-50 tracking-tight tabular-nums">{value}</div>
    </div>
  );
}

function startOfLocalDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfLocalWeekMonday(d: Date) {
  // Monday 00:00 local time
  const day = d.getDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (day + 6) % 7;
  const base = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  base.setDate(base.getDate() - daysSinceMonday);
  return base;
}

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

function computeDurationHours(entry: TimeEntry, now: Date) {
  const inAt = safeDate(entry.clock_in_at);
  if (!inAt) return 0;
  const outAt = entry.clock_out_at ? safeDate(entry.clock_out_at) : now;
  if (!outAt) return 0;
  const ms = Math.max(0, outAt.getTime() - inAt.getTime());
  return ms / 1000 / 60 / 60;
}

function computeDurationHoursWithin(entry: TimeEntry, rangeStart: Date, rangeEnd: Date) {
  const inAt = safeDate(entry.clock_in_at);
  if (!inAt) return 0;
  const outAt = entry.clock_out_at ? safeDate(entry.clock_out_at) : rangeEnd;
  if (!outAt) return 0;
  const startMs = Math.max(inAt.getTime(), rangeStart.getTime());
  const endMs = Math.min(outAt.getTime(), rangeEnd.getTime());
  const ms = Math.max(0, endMs - startMs);
  return ms / 1000 / 60 / 60;
}

export default function WorkersPage() {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const {
    businessId: selectedBusinessId,
    memberRole,
    loading: businessLoading,
    error: businessError,
  } = useAppData();
  const canManageWorkers = memberRole !== 'employee';

  const [addOpen, setAddOpen] = useState(false);
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState('');
  const [formHourly, setFormHourly] = useState(''); // dollars (optional)
  const [formError, setFormError] = useState<string | null>(null);
  const [savingWorker, setSavingWorker] = useState(false);

  const [clockingWorkerId, setClockingWorkerId] = useState<number | null>(null);
  const [clockError, setClockError] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  const [settingsDraft, setSettingsDraft] = useState<BusinessClockSettings>({
    business_id: '',
    clock_in_start: '05:00',
    clock_in_end: '23:00',
    allowed_lat: null,
    allowed_lng: null,
    allowed_radius_m: 250,
    clock_shift_presets: [],
  });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [clockSettingsEditing, setClockSettingsEditing] = useState(false);
  const [clockAdvancedOpen, setClockAdvancedOpen] = useState(false);
  const [clockStartText, setClockStartText] = useState('');
  const [clockEndText, setClockEndText] = useState('');
  const [clockTimeError, setClockTimeError] = useState<{ start: string | null; end: string | null }>({
    start: null,
    end: null,
  });
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false);
  const [shiftPresetsDraft, setShiftPresetsDraft] = useState<Array<{ label: string; timeText: string }>>([]);

  const now = useMemo(() => new Date(), []);
  const weekStartIso = useMemo(() => startOfLocalWeekMonday(new Date()).toISOString(), []);
  const dayStartIso = useMemo(() => startOfLocalDay(new Date()).toISOString(), []);
  const weekStartDate = useMemo(() => safeDate(weekStartIso) ?? new Date(0), [weekStartIso]);
  const dayStartDate = useMemo(() => safeDate(dayStartIso) ?? new Date(0), [dayStartIso]);

  const workersQ = useQuery({
    queryKey: ['workers', selectedBusinessId],
    enabled: Boolean(selectedBusinessId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workers')
        .select('id,business_id,name,role,hourly_rate,is_active,created_at')
        .eq('business_id', selectedBusinessId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as any[]).map((w) => ({
        ...w,
        hourly_rate: w.hourly_rate === null || w.hourly_rate === undefined ? null : Number(w.hourly_rate),
        is_active: Boolean(w.is_active),
      })) as Worker[];
    },
  });

  const settingsQ = useQuery({
    queryKey: ['business_settings_clock', selectedBusinessId],
    enabled: Boolean(selectedBusinessId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('business_settings')
        .select('business_id, clock_in_start, clock_in_end, allowed_lat, allowed_lng, allowed_radius_m, clock_shift_presets')
        .eq('business_id', selectedBusinessId!)
        .maybeSingle();
      if (error) throw error;
      const row: any = data ?? null;
      const out: BusinessClockSettings = {
        business_id: String(row?.business_id ?? selectedBusinessId),
        clock_in_start: String(row?.clock_in_start ?? '05:00'),
        clock_in_end: String(row?.clock_in_end ?? '23:00'),
        allowed_lat: row?.allowed_lat === null || row?.allowed_lat === undefined ? null : Number(row.allowed_lat),
        allowed_lng: row?.allowed_lng === null || row?.allowed_lng === undefined ? null : Number(row.allowed_lng),
        allowed_radius_m: Number(row?.allowed_radius_m ?? 250) || 250,
        clock_shift_presets: Array.isArray(row?.clock_shift_presets) ? (row.clock_shift_presets as any[]) : [],
      };
      return out;
    },
  });

  // Keep draft in sync when loaded.
  React.useEffect(() => {
    if (!settingsQ.data?.business_id) return;
    setSettingsDraft(settingsQ.data);
    if (!clockSettingsEditing) {
      setClockStartText(formatTime12h(settingsQ.data.clock_in_start));
      setClockEndText(formatTime12h(settingsQ.data.clock_in_end));
      setClockTimeError({ start: null, end: null });
    }
    setShiftPresetsDraft(
      (settingsQ.data.clock_shift_presets ?? [])
        .map((p: any) => ({
          label: String(p?.label ?? '').trim(),
          timeText: formatTime12h(String(p?.start_hhmm ?? '').trim() || '06:00'),
        }))
        .filter((p: any) => p.label && p.timeText)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQ.data?.business_id]);

  const openEntriesQ = useQuery({
    queryKey: ['time_entries_open', selectedBusinessId],
    enabled: Boolean(selectedBusinessId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_entries')
        .select('id,business_id,worker_id,clock_in_at,clock_out_at,notes,created_at')
        .eq('business_id', selectedBusinessId!)
        .is('clock_out_at', null)
        .order('clock_in_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as TimeEntry[];
    },
  });

  const weekEntriesQ = useQuery({
    queryKey: ['time_entries_week', selectedBusinessId, weekStartIso],
    enabled: Boolean(selectedBusinessId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_entries')
        .select('id,business_id,worker_id,clock_in_at,clock_out_at,notes,created_at')
        .eq('business_id', selectedBusinessId!)
        .gte('clock_in_at', weekStartIso)
        .order('clock_in_at', { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as TimeEntry[];
    },
  });

  const allEntries = useMemo(() => {
    const map = new Map<number, TimeEntry>();
    for (const e of (openEntriesQ.data ?? [])) map.set(e.id, e);
    for (const e of (weekEntriesQ.data ?? [])) map.set(e.id, e);
    return Array.from(map.values());
  }, [openEntriesQ.data, weekEntriesQ.data]);

  const openByWorker = useMemo(() => {
    const m = new Map<number, TimeEntry>();
    for (const e of (openEntriesQ.data ?? [])) {
      // If multiple open entries exist (shouldn't), keep the newest clock-in.
      const prev = m.get(e.worker_id);
      if (!prev) m.set(e.worker_id, e);
      else if (String(e.clock_in_at) > String(prev.clock_in_at)) m.set(e.worker_id, e);
    }
    return m;
  }, [openEntriesQ.data]);

  const entriesByWorker = useMemo(() => {
    const m = new Map<number, TimeEntry[]>();
    for (const e of allEntries) {
      if (!m.has(e.worker_id)) m.set(e.worker_id, []);
      m.get(e.worker_id)!.push(e);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => String(b.clock_in_at).localeCompare(String(a.clock_in_at)));
    }
    return m;
  }, [allEntries]);

  const workerRows = useMemo(() => {
    const workers = workersQ.data ?? [];
    return workers.map((w) => {
      const open = openByWorker.get(w.id) ?? null;
      const entries = entriesByWorker.get(w.id) ?? [];
      const lastClockIn = entries[0]?.clock_in_at ?? open?.clock_in_at ?? null;

      const weekHours = entries.reduce(
        (sum, e) => sum + computeDurationHoursWithin(e, weekStartDate, now),
        0
      );
      const todayHours = entries.reduce(
        (sum, e) => sum + computeDurationHoursWithin(e, dayStartDate, now),
        0
      );

      return {
        worker: w,
        openEntry: open,
        isClockedIn: Boolean(open && !open.clock_out_at),
        lastClockIn,
        weekHours,
        todayHours,
      };
    });
  }, [workersQ.data, openByWorker, entriesByWorker, now, weekStartDate, dayStartDate]);

  const summary = useMemo(() => {
    const totalWorkers = (workersQ.data ?? []).length;
    const activeNow = workerRows.filter((r) => r.worker.is_active && r.isClockedIn).length;
    const hoursToday = workerRows.reduce((sum, r) => sum + r.todayHours, 0);
    return { totalWorkers, activeNow, hoursToday };
  }, [workersQ.data, workerRows]);

  const loading = businessLoading || workersQ.isLoading || openEntriesQ.isLoading || weekEntriesQ.isLoading;
  const loadError =
    businessError ||
    (workersQ.isError ? String((workersQ.error as any)?.message ?? 'Failed to load workers.') : null) ||
    (openEntriesQ.isError ? String((openEntriesQ.error as any)?.message ?? 'Failed to load time entries.') : null) ||
    (weekEntriesQ.isError ? String((weekEntriesQ.error as any)?.message ?? 'Failed to load time entries.') : null);

  async function saveClockSettings() {
    setSettingsError(null);
    if (!selectedBusinessId) {
      setSettingsError('Loading your business…');
      return;
    }
    const parsedStart = parseTime12hToHHMM(clockStartText);
    const parsedEnd = parseTime12hToHHMM(clockEndText);
    setClockTimeError({ start: parsedStart.error, end: parsedEnd.error });
    if (!parsedStart.hhmm || !parsedEnd.hhmm) {
      setSettingsError('Fix the clock window times before saving.');
      return;
    }
    const start = parsedStart.hhmm;
    const end = parsedEnd.hhmm;

    const presets: Array<{ label: string; start_hhmm: string }> = [];
    for (const row of shiftPresetsDraft) {
      const label = String(row?.label ?? '').trim();
      const timeText = String(row?.timeText ?? '').trim();
      if (!label && !timeText) continue;
      if (!label) {
        setSettingsError('Each shift preset must have a name.');
        return;
      }
      const parsed = parseTime12hToHHMM(timeText);
      if (!parsed.hhmm) {
        setSettingsError(`Shift "${label}" has an invalid time. Use e.g. 6:00 AM.`);
        return;
      }
      presets.push({ label, start_hhmm: parsed.hhmm });
    }

    setSettingsSaving(true);
    try {
      const payload: any = {
        business_id: selectedBusinessId,
        clock_in_start: start,
        clock_in_end: end,
        allowed_lat: settingsDraft.allowed_lat,
        allowed_lng: settingsDraft.allowed_lng,
        allowed_radius_m: Number(settingsDraft.allowed_radius_m) || 250,
        clock_shift_presets: presets,
      };
      const { error } = await supabase
        .from('business_settings')
        .upsert(payload, { onConflict: 'business_id' });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['business_settings_clock', selectedBusinessId] });
      pushToast({ tone: 'ok', message: 'Clock settings saved.' });
      setSettingsDraft((p) => ({ ...p, clock_in_start: start, clock_in_end: end }));
      setClockSettingsEditing(false);
      setClockAdvancedOpen(false);
    } catch (e: any) {
      setSettingsError(String(e?.message ?? 'Could not save clock settings.'));
    } finally {
      setSettingsSaving(false);
    }
  }

  async function useMyLocationForGeofence() {
    try {
      setSettingsError(null);
      if (typeof window === 'undefined' || !navigator.geolocation) {
        throw new Error('Geolocation is not available in this browser.');
      }
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0,
        });
      });
      setSettingsDraft((p) => ({
        ...p,
        allowed_lat: pos.coords.latitude,
        allowed_lng: pos.coords.longitude,
      }));
      pushToast({ tone: 'ok', message: 'Geofence location set to your current position.' });
    } catch (e: any) {
      setSettingsError(String(e?.message ?? 'Could not read location.'));
    }
  }

  async function submitInvite() {
    // eslint-disable-next-line no-console
    console.log('INVITE_SUBMIT_CLICKED');

    setInviteError(null);
    if (!selectedBusinessId) {
      setInviteError('Loading your business…');
      return;
    }
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      setInviteError('Enter a valid email.');
      return;
    }

    setInviting(true);
    try {
      // eslint-disable-next-line no-console
      console.log('WORKER_INVITE_INSERT_PAYLOAD', { business_id: selectedBusinessId, email, role: 'employee' });

      const { data, error } = await supabase
        .from('worker_invites')
        .upsert(
          { business_id: selectedBusinessId, email, role: 'employee', accepted: false } as any,
          { onConflict: 'business_id,email' }
        )
        .select()
        .single();

      // eslint-disable-next-line no-console
      console.log('WORKER_INVITE_INSERT_RESULT', {
        data,
        error: error
          ? {
              code: (error as any)?.code ?? null,
              message: (error as any)?.message ?? String(error),
              details: (error as any)?.details ?? null,
              hint: (error as any)?.hint ?? null,
            }
          : null,
      });

      if (error) throw error;
      if (!data) throw new Error('Invite insert returned no row. Check RLS and table schema.');

      pushToast({ tone: 'ok', message: 'Invite created.' });
      setInviteOpen(false);
      setInviteEmail('');
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('INVITE_FAILED', e);
      const msg = String(e?.message ?? 'Invite failed.');
      setInviteError(msg);
      pushToast({ tone: 'error', message: msg });
    } finally {
      setInviting(false);
    }
  }

  async function handleAddWorker() {
    setFormError(null);
    if (!canManageWorkers) {
      setFormError('Forbidden: employees cannot add workers.');
      return;
    }
    if (!selectedBusinessId) {
      setFormError('Loading your business…');
      return;
    }

    // Debug: log the auth/user + business_id values that RLS policies rely on.
    // This does NOT bypass RLS; it only helps surface why WITH CHECK might be false.
    try {
      const { data: sess } = await supabase.auth.getSession();
      const authUserId = sess.session?.user?.id ?? null;
      const activeBusinessId = selectedBusinessId;
      // eslint-disable-next-line no-console
      console.log('WORKERS_INSERT_DEBUG_CLIENT', { authUserId, activeBusinessId });

      const { data: who, error: whoErr } = await supabase.rpc('rls_debug_whoami');
      if (whoErr) {
        // eslint-disable-next-line no-console
        console.log('WORKERS_INSERT_DEBUG_WHOAMI_ERR', {
          code: (whoErr as any)?.code ?? null,
          message: (whoErr as any)?.message ?? String(whoErr),
          details: (whoErr as any)?.details ?? null,
          hint: (whoErr as any)?.hint ?? null,
        });
      } else {
        // eslint-disable-next-line no-console
        console.log('WORKERS_INSERT_DEBUG_WHOAMI', who);
      }

      const { data: can, error: canErr } = await supabase.rpc('rls_debug_can_insert_worker', {
        p_business_id: selectedBusinessId,
      });
      if (canErr) {
        // eslint-disable-next-line no-console
        console.log('WORKERS_INSERT_DEBUG_CAN_INSERT_ERR', {
          code: (canErr as any)?.code ?? null,
          message: (canErr as any)?.message ?? String(canErr),
          details: (canErr as any)?.details ?? null,
          hint: (canErr as any)?.hint ?? null,
        });
      } else {
        // eslint-disable-next-line no-console
        console.log('WORKERS_INSERT_DEBUG_CAN_INSERT', can);
      }
    } catch (e) {
      // Never block the insert due to debug helpers.
      // eslint-disable-next-line no-console
      console.log('WORKERS_INSERT_DEBUG_UNCAUGHT', String((e as any)?.message ?? e));
    }

    // Extra guard: ensure this business is visible to the current authed owner (helps diagnose RLS mismatches).
    try {
      const { data: bRow, error: bErr } = await supabase
        .from('business')
        .select('id')
        .eq('id', selectedBusinessId)
        .maybeSingle();
      if (bErr) throw bErr;
      if (!bRow?.id) {
        setFormError('Active business not found for this user. Check business ownership / RLS.');
        return;
      }
    } catch (e: any) {
      setFormError(String(e?.message ?? 'Could not validate active business.'));
      return;
    }
    const name = formName.trim();
    const role = formRole.trim();
    if (!name) {
      setFormError('Worker name is required.');
      return;
    }
    if (!role) {
      setFormError('Role is required.');
      return;
    }
    const hourly =
      formHourly.trim() === '' ? null : Number.parseFloat(formHourly.trim().replace(/[^\d.\-]/g, ''));
    if (hourly !== null && !Number.isFinite(hourly)) {
      setFormError('Hourly rate must be a valid number.');
      return;
    }

    setSavingWorker(true);
    try {
      const activeBusinessId = selectedBusinessId;
      const payload: any = {
        business_id: activeBusinessId,
        name,
        role,
        hourly_rate: hourly,
        is_active: true,
        // Some DBs may not have defaults applied yet; set explicitly to satisfy NOT NULL.
        created_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('workers')
        .insert(payload)
        .select()
        .single();

      // eslint-disable-next-line no-console
      console.log('WORKERS_INSERT_RESULT', {
        business_id: activeBusinessId,
        payload,
        data,
        error: error
          ? {
              code: (error as any)?.code ?? null,
              message: (error as any)?.message ?? String(error),
              details: (error as any)?.details ?? null,
              hint: (error as any)?.hint ?? null,
            }
          : null,
      });
      if (error) throw error;
      if (!data) throw new Error('Worker insert returned no data.');

      setAddOpen(false);
      setFormName('');
      setFormRole('');
      setFormHourly('');
      await queryClient.invalidateQueries({ queryKey: ['workers', selectedBusinessId] });
    } catch (e: any) {
      const msg = String(e?.message ?? 'Could not add worker.');
      const code = (e as any)?.code ? `code: ${(e as any).code}` : null;
      const details = (e as any)?.details ? `details: ${(e as any).details}` : null;
      const hint = (e as any)?.hint ? `hint: ${(e as any).hint}` : null;
      setFormError([msg, code, details, hint].filter(Boolean).join('\n'));
    } finally {
      setSavingWorker(false);
    }
  }

  async function toggleClock(workerId: number) {
    if (!selectedBusinessId) return;
    setClockError(null);
    setClockingWorkerId(workerId);
    try {
      const open = openByWorker.get(workerId) ?? null;
      if (!open) {
        // Clock in
        const payload: any = {
          business_id: selectedBusinessId,
          worker_id: workerId,
          clock_in_at: new Date().toISOString(),
          clock_out_at: null,
          notes: null,
        };
        const { data, error } = await supabase
          .from('time_entries')
          .insert(payload)
          .select('id')
          .single();
        if (error) throw error;
        if (!data?.id) throw new Error('Clock in failed to return a time entry id.');
      } else {
        // Clock out
        const { error } = await supabase
          .from('time_entries')
          .update({ clock_out_at: new Date().toISOString() } as any)
          .eq('id', open.id)
          .eq('business_id', selectedBusinessId);
        if (error) throw error;
      }

      await queryClient.invalidateQueries({ queryKey: ['time_entries_open', selectedBusinessId] });
      await queryClient.invalidateQueries({ queryKey: ['time_entries_week', selectedBusinessId, weekStartIso] });
    } catch (e: any) {
      setClockError(String(e?.message ?? 'Clock action failed.'));
    } finally {
      setClockingWorkerId(null);
    }
  }

  return (
    <main className="space-y-4">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workers</h1>
          <p className="text-slate-400 text-sm mt-1">
            Manage your team and time tracking.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManageWorkers && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200 hover:bg-emerald-500/20"
            >
              Add Worker
            </button>
          )}
        </div>
      </header>

      {loadError && <div className="text-xs text-rose-300">{loadError}</div>}
      {!loadError && loading && <div className="text-xs text-slate-400">Loading workers…</div>}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon={<UserCheck className="h-4 w-4 text-emerald-200" />}
          label="Active Now"
          value={loading ? '—' : summary.activeNow.toLocaleString('en-US')}
        />
        <StatCard
          icon={<Users className="h-4 w-4 text-sky-200" />}
          label="Total Workers"
          value={loading ? '—' : summary.totalWorkers.toLocaleString('en-US')}
        />
        <StatCard
          icon={<Clock className="h-4 w-4 text-violet-200" />}
          label="Hours Today"
          value={loading ? '—' : `${summary.hoursToday.toFixed(1)}h`}
        />
      </section>

      {canManageWorkers && (
        <section className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-3 shadow-[0_1px_0_rgba(255,255,255,0.04)]">
        <button
          type="button"
          onClick={() => setAdvancedSettingsOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/5 transition"
        >
          <div>
            <div className="text-sm font-semibold text-slate-100">Advanced settings</div>
            <div className="mt-0.5 text-[11px] text-slate-400">
              Configure employee clock restrictions + shift buttons.
            </div>
          </div>
          <div className="text-[11px] text-slate-300">{advancedSettingsOpen ? 'Hide' : 'Show'}</div>
        </button>

        {advancedSettingsOpen && (
          <div className="mt-3 rounded-2xl bg-slate-900/60 border border-slate-800 p-4 md:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">Clock Settings</div>
                <div className="mt-1 text-[11px] text-slate-400">
                  Used by Employee Clock for time window + location verification.
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Geofence:{' '}
                  {settingsDraft.allowed_lat !== null && settingsDraft.allowed_lng !== null ? (
                    <span className="text-emerald-200">Configured</span>
                  ) : (
                    <span className="text-slate-300">Not set</span>
                  )}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Clock window:{' '}
                  <span className="text-slate-200">
                    {formatClockWindow12h(settingsDraft.clock_in_start, settingsDraft.clock_in_end)}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Shift buttons:{' '}
                  {shiftPresetsDraft.length > 0 ? (
                    <span className="text-slate-200">{shiftPresetsDraft.length} configured</span>
                  ) : (
                    <span className="text-slate-300">Not set</span>
                  )}
                </div>
              </div>
              {clockSettingsEditing ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={settingsSaving}
                    onClick={() => void saveClockSettings()}
                    className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    {settingsSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    disabled={settingsSaving}
                    onClick={() => {
                      if (settingsQ.data) setSettingsDraft(settingsQ.data);
                      setClockAdvancedOpen(false);
                      setClockSettingsEditing(false);
                      if (settingsQ.data) {
                        setClockStartText(formatTime12h(settingsQ.data.clock_in_start));
                        setClockEndText(formatTime12h(settingsQ.data.clock_in_end));
                        setShiftPresetsDraft(
                          (settingsQ.data.clock_shift_presets ?? [])
                            .map((p: any) => ({
                              label: String(p?.label ?? '').trim(),
                              timeText: formatTime12h(String(p?.start_hhmm ?? '').trim() || '06:00'),
                            }))
                            .filter((p: any) => p.label && p.timeText)
                        );
                      }
                      setClockTimeError({ start: null, end: null });
                    }}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-slate-200 hover:bg-white/10 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setClockStartText(formatTime12h(settingsDraft.clock_in_start));
                    setClockEndText(formatTime12h(settingsDraft.clock_in_end));
                    setClockTimeError({ start: null, end: null });
                    setClockSettingsEditing(true);
                  }}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-slate-200 hover:bg-white/10"
                >
                  Edit
                </button>
              )}
            </div>

            {settingsError && (
              <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
                {settingsError}
              </div>
            )}

            {clockSettingsEditing && (
              <>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="text-[11px] text-slate-400">
                    Start time
                    <input
                      value={clockStartText}
                      onChange={(e) => {
                        const next = e.target.value;
                        setClockStartText(next);
                        const parsed = parseTime12hToHHMM(next);
                        setClockTimeError((p) => ({ ...p, start: parsed.error }));
                        if (parsed.hhmm) setSettingsDraft((p) => ({ ...p, clock_in_start: parsed.hhmm! }));
                      }}
                      placeholder="6:00 AM"
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-100"
                    />
                    {clockTimeError.start ? (
                      <div className="mt-1 text-[11px] text-rose-200">{clockTimeError.start}</div>
                    ) : (
                      <div className="mt-1 text-[11px] text-slate-500">Example: 6:00 AM</div>
                    )}
                  </label>
                  <label className="text-[11px] text-slate-400">
                    End time
                    <input
                      value={clockEndText}
                      onChange={(e) => {
                        const next = e.target.value;
                        setClockEndText(next);
                        const parsed = parseTime12hToHHMM(next);
                        setClockTimeError((p) => ({ ...p, end: parsed.error }));
                        if (parsed.hhmm) setSettingsDraft((p) => ({ ...p, clock_in_end: parsed.hhmm! }));
                      }}
                      placeholder="11:00 PM"
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-100"
                    />
                    {clockTimeError.end ? (
                      <div className="mt-1 text-[11px] text-rose-200">{clockTimeError.end}</div>
                    ) : (
                      <div className="mt-1 text-[11px] text-slate-500">Example: 11:00 PM</div>
                    )}
                  </label>
                </div>

                <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/30 p-3">
                  <div className="text-[11px] text-slate-300 font-semibold">Employee shift buttons</div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    These appear as clock-in buttons on <span className="text-slate-300">/clock</span> (e.g. Morning / Noon / Late).
                  </div>
                  <div className="mt-3 space-y-2">
                    {(shiftPresetsDraft ?? []).length === 0 ? (
                      <div className="text-[11px] text-slate-500">No shift buttons configured.</div>
                    ) : (
                      shiftPresetsDraft.map((row, idx) => (
                        <div key={idx} className="grid gap-2 md:grid-cols-[1fr,220px,auto] items-start">
                          <label className="text-[11px] text-slate-400">
                            Button name
                            <input
                              value={row.label}
                              onChange={(e) => {
                                const next = e.target.value;
                                setShiftPresetsDraft((p) =>
                                  p.map((x, i) => (i === idx ? { ...x, label: next } : x))
                                );
                              }}
                              placeholder="Morning shift"
                              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-100"
                            />
                          </label>
                          <label className="text-[11px] text-slate-400">
                            Display time
                            <input
                              value={row.timeText}
                              onChange={(e) => {
                                const next = e.target.value;
                                setShiftPresetsDraft((p) =>
                                  p.map((x, i) => (i === idx ? { ...x, timeText: next } : x))
                                );
                              }}
                              placeholder="6:00 AM"
                              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-100"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => setShiftPresetsDraft((p) => p.filter((_, i) => i !== idx))}
                            className="mt-6 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-slate-200 hover:bg-white/10"
                          >
                            Remove
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setShiftPresetsDraft((p) => [...p, { label: '', timeText: '' }])
                      }
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-slate-200 hover:bg-white/10"
                    >
                      Add shift button
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setShiftPresetsDraft([
                          { label: 'Morning shift', timeText: '6:00 AM' },
                          { label: 'Noon shift', timeText: '12:00 PM' },
                          { label: 'Late shift', timeText: '6:00 PM' },
                        ])
                      }
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-slate-200 hover:bg-white/10"
                    >
                      Use defaults
                    </button>
                  </div>
                </div>

                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setClockAdvancedOpen((v) => !v)}
                    className="text-[11px] text-slate-300 hover:text-slate-100"
                  >
                    {clockAdvancedOpen ? 'Hide' : 'Show'} advanced location settings
                  </button>

                  {clockAdvancedOpen && (
                    <div className="mt-3 grid gap-3 md:grid-cols-[1fr,1fr,auto] items-end">
                      <label className="text-[11px] text-slate-400 md:col-span-2">
                        Radius (meters)
                        <input
                          value={String(settingsDraft.allowed_radius_m ?? 250)}
                          onChange={(e) =>
                            setSettingsDraft((p) => ({
                              ...p,
                              allowed_radius_m: Number(e.target.value) || 250,
                            }))
                          }
                          inputMode="numeric"
                          placeholder="250"
                          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-100"
                        />
                      </label>
                      <label className="text-[11px] text-slate-400">
                        Allowed latitude
                        <input
                          value={settingsDraft.allowed_lat === null ? '' : String(settingsDraft.allowed_lat)}
                          onChange={(e) =>
                            setSettingsDraft((p) => ({
                              ...p,
                              allowed_lat: e.target.value.trim() === '' ? null : Number(e.target.value),
                            }))
                          }
                          inputMode="decimal"
                          placeholder="e.g. 30.2672"
                          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-100"
                        />
                      </label>
                      <label className="text-[11px] text-slate-400">
                        Allowed longitude
                        <input
                          value={settingsDraft.allowed_lng === null ? '' : String(settingsDraft.allowed_lng)}
                          onChange={(e) =>
                            setSettingsDraft((p) => ({
                              ...p,
                              allowed_lng: e.target.value.trim() === '' ? null : Number(e.target.value),
                            }))
                          }
                          inputMode="decimal"
                          placeholder="e.g. -97.7431"
                          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-100"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => void useMyLocationForGeofence()}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-slate-200 hover:bg-white/10"
                      >
                        Use my location
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
        </section>
      )}

      <section className="rounded-2xl bg-slate-900/80 border border-slate-700 p-4 md:p-5">
        {clockError && <div className="mb-3 text-xs text-rose-300">{clockError}</div>}

        {(workersQ.data ?? []).length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5">
            <div className="text-sm font-semibold text-slate-100">No workers yet</div>
            <div className="mt-1 text-[11px] text-slate-400">
              Add your first worker to start tracking time in one place.
            </div>
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200 hover:bg-emerald-500/20"
              >
                Add Worker
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/40">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-950/60 text-[11px] text-slate-400">
                <tr>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Role</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Last clock in</th>
                  <th className="text-right px-4 py-3">Total hours (week)</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {workerRows.map((row) => {
                  const w = row.worker;
                  const status = !w.is_active ? 'Inactive' : row.isClockedIn ? 'Clocked In' : 'Clocked Out';
                  const statusClasses = !w.is_active
                    ? 'border-white/10 bg-white/5 text-slate-300'
                    : row.isClockedIn
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                      : 'border-slate-700 bg-slate-900/40 text-slate-200';

                  const btnDisabled = !w.is_active || clockingWorkerId === w.id;
                  const btnLabel = row.isClockedIn ? 'Clock Out' : 'Clock In';

                  return (
                    <tr key={w.id} className="border-t border-white/10 hover:bg-white/[0.04] transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-100">{w.name}</div>
                        {w.hourly_rate !== null ? (
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {formatCurrency(Number(w.hourly_rate))}/hr
                          </div>
                        ) : (
                          <div className="mt-0.5 text-[11px] text-slate-600">—</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-200">{w.role || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] ${statusClasses}`}>
                          {status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{fmtWhen(row.lastClockIn)}</td>
                      <td className="px-4 py-3 text-right text-slate-100 tabular-nums">
                        {row.weekHours.toFixed(1)}h
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            // Debug: confirm click is firing.
                            // eslint-disable-next-line no-console
                            console.log('INVITE_CLICKED');

                            try {
                              e.preventDefault();
                              e.stopPropagation();
                              setInviteEmail('');
                              setInviteError(null);
                              setInviteOpen(true);
                            } catch (err: any) {
                              // eslint-disable-next-line no-console
                              console.error('INVITE_FAILED', err);
                              pushToast({
                                tone: 'error',
                                message: String(err?.message ?? 'Invite failed to open.'),
                              });
                            }
                          }}
                          className="pointer-events-auto rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-slate-100 hover:bg-white/10 mr-2"
                        >
                          Invite
                        </button>
                        <button
                          type="button"
                          disabled={btnDisabled}
                          onClick={() => void toggleClock(w.id)}
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-slate-100 hover:bg-white/10 disabled:opacity-50"
                        >
                          {clockingWorkerId === w.id ? 'Saving…' : btnLabel}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950/90 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Workers
                </div>
                <div className="mt-2 text-lg font-semibold text-slate-50 tracking-tight">
                  Add worker
                </div>
                <div className="mt-1 text-sm text-slate-300">
                  Create a worker profile. Payroll setup comes later.
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAddOpen(false);
                  setFormError(null);
                }}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-slate-200 hover:bg-white/10"
              >
                Close
              </button>
            </div>

            {formError && (
              <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
                {formError}
              </div>
            )}

            <div className="mt-4 grid gap-3">
              <label className="text-[11px] text-slate-400">
                Name
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Alex Johnson"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
              </label>
              <label className="text-[11px] text-slate-400">
                Role
                <input
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value)}
                  placeholder="e.g. Technician"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
              </label>
              <label className="text-[11px] text-slate-400">
                Hourly rate (optional)
                <input
                  value={formHourly}
                  onChange={(e) => setFormHourly(e.target.value)}
                  inputMode="decimal"
                  placeholder="$25"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
              </label>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-slate-200 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingWorker}
                onClick={() => void handleAddWorker()}
                className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
              >
                {savingWorker ? 'Adding…' : 'Add Worker'}
              </button>
            </div>
          </div>
        </div>
      )}

      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950/90 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Employees
                </div>
                <div className="mt-2 text-lg font-semibold text-slate-50 tracking-tight">
                  Invite employee
                </div>
                <div className="mt-1 text-sm text-slate-300">
                  Creates an invite record for this business. (Email delivery + auto-linking happens later.)
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInviteOpen(false)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-slate-200 hover:bg-white/10"
              >
                Close
              </button>
            </div>

            {inviteError && (
              <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
                {inviteError}
              </div>
            )}

            <div className="mt-4 grid gap-3">
              <label className="text-[11px] text-slate-400">
                Employee email
                <input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="worker@company.com"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-100"
                />
              </label>
              <div className="text-[11px] text-slate-500">
                This employee will only be able to access <span className="text-slate-200">/clock</span>.
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setInviteOpen(false)}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-slate-200 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={inviting || !inviteEmail.trim() || !inviteEmail.includes('@')}
                onClick={() => void submitInvite()}
                className="pointer-events-auto rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
              >
                {inviting ? 'Inviting…' : 'Send invite'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}


