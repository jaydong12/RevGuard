'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../utils/supabaseClient';
import { useAppData } from '../../../components/AppDataProvider';
import { useToast } from '../../../components/ToastProvider';
import {
  CalendarDays,
  CalendarRange,
  Clock,
  DollarSign,
  LayoutGrid,
  List,
  Plus,
  Pencil,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { MobileFab } from '../../../components/mobile/MobileFab';

function pad2(n: number) {
  return String(Math.floor(Math.abs(n))).padStart(2, '0');
}

type AmPm = 'AM' | 'PM';

function formatLocalPretty(iso: string): string {
  const d = new Date(String(iso ?? ''));
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

function safeTimeLabel(iso: any): string {
  const d = new Date(String(iso ?? ''));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function safeWhenLabel(iso: any): string {
  const d = new Date(String(iso ?? ''));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatNotesForDisplay(notes: any): string {
  const s = String(notes ?? '').trim();
  if (!s) return '';
  return s.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, (m) => formatLocalPretty(m));
}

function formatNotesInline(notes: any): string {
  const s = formatNotesForDisplay(notes);
  if (!s) return '';
  return s.replace(/\s*\n+\s*/g, ' • ').slice(0, 140);
}

function isMissingColumnError(err: any) {
  return String(err?.code ?? '') === '42703' || /column .* does not exist/i.test(String(err?.message ?? ''));
}

function formatMaskedStart(digits: string, ampm: AmPm): string {
  const ds = String(digits ?? '').replace(/\D/g, '').slice(0, 12);
  const m1 = ds[0] ?? '_';
  const m2 = ds[1] ?? '_';
  const d1 = ds[2] ?? '_';
  const d2 = ds[3] ?? '_';
  const y1 = ds[4] ?? '_';
  const y2 = ds[5] ?? '_';
  const y3 = ds[6] ?? '_';
  const y4 = ds[7] ?? '_';
  const h1 = ds[8] ?? '_';
  const h2 = ds[9] ?? '_';
  const n1 = ds[10] ?? '_';
  const n2 = ds[11] ?? '_';
  return `${m1}${m2}/${d1}${d2}/${y1}${y2}${y3}${y4} · ${h1}${h2}:${n1}${n2} ${ampm}`;
}

function parseMaskedDigitsToIso(digits: string, ampm: AmPm): string | null {
  const ds = String(digits ?? '').replace(/\D/g, '').slice(0, 12);
  if (ds.length !== 12) return null;
  const month = Number(ds.slice(0, 2));
  const day = Number(ds.slice(2, 4));
  const year = Number(ds.slice(4, 8));
  let hour12 = Number(ds.slice(8, 10));
  const minute = Number(ds.slice(10, 12));

  if (!(month >= 1 && month <= 12)) return null;
  if (!(day >= 1 && day <= 31)) return null;
  if (!(year >= 2000 && year <= 2100)) return null;
  if (!(hour12 >= 1 && hour12 <= 12)) return null;
  if (!(minute >= 0 && minute <= 59)) return null;

  let hour24 = hour12 % 12;
  if (ampm === 'PM') hour24 += 12;

  const d = new Date(year, month - 1, day, hour24, minute, 0, 0); // local time
  // Validate (catches invalid days like 02/31).
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day ||
    d.getHours() !== hour24 ||
    d.getMinutes() !== minute
  ) {
    return null;
  }
  return d.toISOString();
}

function formatMaskedStartCompact(digits: string, ampm: AmPm): string {
  const ds = String(digits ?? '').replace(/\D/g, '').slice(0, 12);
  const m1 = ds[0] ?? '_';
  const m2 = ds[1] ?? '_';
  const d1 = ds[2] ?? '_';
  const d2 = ds[3] ?? '_';
  const y1 = ds[4] ?? '_';
  const y2 = ds[5] ?? '_';
  const y3 = ds[6] ?? '_';
  const y4 = ds[7] ?? '_';
  const h1 = ds[8] ?? '_';
  const h2 = ds[9] ?? '_';
  const n1 = ds[10] ?? '_';
  const n2 = ds[11] ?? '_';
  return `${m1}${m2}/${d1}${d2}/${y1}${y2}${y3}${y4} ${h1}${h2}:${n1}${n2} ${ampm}`;
}

export default function BookingsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const { businessId, customers } = useAppData();

  type TabKey = 'calendar' | 'list' | 'services';

  const [tab, setTab] = useState<TabKey>('calendar');
  const [focusDate, setFocusDate] = useState(() => new Date());

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeBooking, setActiveBooking] = useState<any | null>(null);
  const [listPage, setListPage] = useState(1);
  const listPageSize = 10;
  const [paidBusyId, setPaidBusyId] = useState<string | null>(null);

  const [dayPanelOpen, setDayPanelOpen] = useState(false);
  const [dayPanelKey, setDayPanelKey] = useState<string | null>(null); // YYYY-MM-DD

  const [createOpen, setCreateOpen] = useState(false);
  const [createServiceId, setCreateServiceId] = useState<string | null>(null);
  const [createCustomerId, setCreateCustomerId] = useState<string | null>(null);
  const [createStartDigits, setCreateStartDigits] = useState<string>('');
  const [createStartAmPm, setCreateStartAmPm] = useState<AmPm>('AM');
  const [createNotes, setCreateNotes] = useState<string>('');
  const [createErrors, setCreateErrors] = useState<string[]>([]);
  const [createSaving, setCreateSaving] = useState(false);

  const createStartIso = useMemo(() => parseMaskedDigitsToIso(createStartDigits, createStartAmPm), [createStartDigits, createStartAmPm]);

  function isUuid(v: any): boolean {
    const s = String(v ?? '').trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
  }

  function parsePositiveInt(v: any): number | null {
    const s = String(v ?? '').trim();
    if (!s) return null;
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  }

  function startOfWeek(d: Date) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    const dow = x.getDay(); // 0 Sun
    x.setDate(x.getDate() - dow);
    return x;
  }

  function endOfWeek(d: Date) {
    const s = startOfWeek(d);
    const e = new Date(s);
    e.setDate(e.getDate() + 6);
    e.setHours(23, 59, 59, 999);
    return e;
  }

  function startOfMonth(d: Date) {
    return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  }

  function endOfMonth(d: Date) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  function rangeForView() {
    // Calendar is month-only.
    return { from: startOfMonth(focusDate), to: endOfMonth(focusDate) };
  }

  const { from, to } = useMemo(() => rangeForView(), [focusDate]);
  const fromIso = useMemo(() => from.toISOString(), [from]);
  const toIso = useMemo(() => to.toISOString(), [to]);

  const servicesQ = useQuery({
    queryKey: ['services', businessId],
    enabled: Boolean(businessId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .eq('business_id', businessId!)
        .eq('is_active', true)
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message ?? 'Failed to load services.');
      return (data ?? []) as any[];
    },
  });

  const bookingsQ = useQuery({
    queryKey: ['bookings', businessId, fromIso, toIso],
    enabled: Boolean(businessId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .eq('business_id', businessId!)
        .gte('start_at', fromIso)
        .lte('start_at', toIso)
        .order('start_at', { ascending: true });
      if (error) throw new Error(error.message ?? 'Failed to load bookings.');
      return (data ?? []) as any[];
    },
  });

  // Upcoming count is global (not limited to the currently viewed month).
  const upcomingCountQ = useQuery({
    queryKey: ['bookings_upcoming_count', businessId],
    enabled: Boolean(businessId),
    refetchInterval: 60_000, // time-based drift (bookings crossing "now") + keep it feeling live
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const { count, error } = await supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId!)
        .in('status', ['pending', 'confirmed'] as any)
        .gte('start_at', nowIso);
      if (error) throw new Error(error.message ?? 'Failed to load upcoming bookings count.');
      return Number(count ?? 0) || 0;
    },
  });

  // Revenue Scheduled is global (sum of all future bookings, across all months).
  // Use bookings.price_cents snapshot only (authoritative). Ignore invoices/services.
  const revenueScheduledQ = useQuery({
    queryKey: ['bookings_revenue_scheduled', businessId],
    enabled: Boolean(businessId),
    refetchInterval: 60_000,
    queryFn: async () => {
      const nowIso = new Date().toISOString();

      // Pull upcoming bookings with price snapshots and sum in cents.
      // If the column doesn't exist yet, return 0 (migration needed).
      const { data: rows, error: bErr } = await supabase
        .from('bookings')
        .select('id,start_at,service_id,invoice_id,price_cents')
        .eq('business_id', businessId!)
        .in('status', ['pending', 'confirmed'] as any)
        .gte('start_at', nowIso)
        .order('start_at', { ascending: true })
        .limit(5000);

      if (bErr) {
        if (isMissingColumnError(bErr)) {
          return 0;
        }
        throw new Error((bErr as any)?.message ?? 'Failed to load revenue scheduled.');
      }

      const all = (rows ?? []) as any[];

      let sumCents = 0;
      for (const b of all) {
        const cents = Math.max(0, Number(b?.price_cents ?? 0) || 0);
        sumCents += cents;
      }

      return (Number.isFinite(sumCents) ? sumCents : 0) / 100;
    },
  });

  const invoicesQ = useQuery({
    queryKey: ['booking_invoices', businessId, bookingsQ.data?.length ?? 0],
    enabled: Boolean(businessId),
    queryFn: async () => {
      const bookingIds = (bookingsQ.data ?? []).map((b: any) => Number(b.id)).filter(Boolean);
      if (!bookingIds.length) return [] as any[];
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .eq('business_id', businessId!)
        .in('booking_id', bookingIds as any);
      if (error) throw new Error(error.message ?? 'Failed to load booking invoices.');
      return (data ?? []) as any[];
    },
  });

  const customerById = useMemo(() => {
    const m = new Map<string, any>();
    for (const c of (customers as any[]) ?? []) m.set(String(c.id), c);
    return m;
  }, [customers]);

  const serviceById = useMemo(() => {
    const m = new Map<string, any>();
    for (const s of (servicesQ.data ?? []) as any[]) m.set(String(s.id), s);
    return m;
  }, [servicesQ.data]);

  const invoiceByBookingId = useMemo(() => {
    const m = new Map<string, any>();
    for (const inv of (invoicesQ.data ?? []) as any[]) {
      if (inv?.booking_id != null) m.set(String(inv.booking_id), inv);
    }
    return m;
  }, [invoicesQ.data]);

  // Realtime: keep bookings + booking-linked invoices fresh for stats + UI.
  useEffect(() => {
    if (!businessId) return;

    const ch = supabase
      .channel(`rg-bookings-${businessId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `business_id=eq.${businessId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['bookings', businessId] });
          void queryClient.invalidateQueries({ queryKey: ['bookings_upcoming_count', businessId] });
          void queryClient.invalidateQueries({ queryKey: ['bookings_revenue_scheduled', businessId] });
          void queryClient.invalidateQueries({ queryKey: ['booking_invoices', businessId] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'invoices', filter: `business_id=eq.${businessId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['booking_invoices', businessId] });
          void queryClient.invalidateQueries({ queryKey: ['bookings_revenue_scheduled', businessId] });
        }
      )
      .subscribe();

    return () => {
      try {
        void supabase.removeChannel(ch);
      } catch {
        // ignore
      }
    };
  }, [businessId, queryClient]);

  const bookingsByDay = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const b of (bookingsQ.data ?? []) as any[]) {
      const d = new Date(b.start_at);
      const key = d.toISOString().slice(0, 10);
      m.set(key, [...(m.get(key) ?? []), b]);
    }
    return m;
  }, [bookingsQ.data]);

  const stats = useMemo(() => {
    const all = (bookingsQ.data ?? []) as any[];
    const now = Date.now();
    const upcomingLocalFallback = all.filter((b) => {
      const s = String(b.status);
      return (s === 'pending' || s === 'confirmed') && new Date(b.start_at).getTime() >= now;
    }).length;
    const upcoming = typeof upcomingCountQ.data === 'number' ? upcomingCountQ.data : upcomingLocalFallback;
    const weekFrom = startOfWeek(new Date()).getTime();
    const weekTo = endOfWeek(new Date()).getTime();
    const thisWeek = all.filter((b) => {
      const t = new Date(b.start_at).getTime();
      const s = String(b.status);
      return (s === 'pending' || s === 'confirmed') && t >= weekFrom && t <= weekTo;
    }).length;

    // Revenue Scheduled: global sum (all future bookings), fetched from Supabase.
    // Fallback to local (month-only) computation if query isn't ready yet.
    let revenueScheduled =
      typeof revenueScheduledQ.data === 'number'
        ? Number(revenueScheduledQ.data)
        : 0;

    if (!(typeof revenueScheduledQ.data === 'number')) {
      for (const b of all) {
        const bs = String(b.status);
        if (!(bs === 'pending' || bs === 'confirmed')) continue;
        const t = new Date(b.start_at).getTime();
        if (!Number.isFinite(t) || t < now) continue;

        const inv = invoiceByBookingId.get(String(b.id));
        if (inv) {
          revenueScheduled += Number(inv.total) || 0;
          continue;
        }

        const svc = b.service_id ? serviceById.get(String(b.service_id)) : null;
        if (svc) revenueScheduled += (Number(svc.price_cents) || 0) / 100;
      }
    }

    return { upcoming, thisWeek, revenueScheduled };
  }, [bookingsQ.data, invoiceByBookingId, serviceById, upcomingCountQ.data, revenueScheduledQ.data]);

  function openBooking(b: any) {
    setActiveBooking(b);
    setDrawerOpen(true);
  }

  async function patchBooking(id: string | number, patch: any) {
    if (!businessId) {
      pushToast({ tone: 'error', message: 'Missing business. Please reload.' });
      return;
    }
    const idStr = String(id ?? '').trim();
    if (!idStr) {
      pushToast({ tone: 'error', message: 'Invalid booking id.' });
      return;
    }
    // eslint-disable-next-line no-console
    console.log('BOOKING_PATCH_ID', { id: idStr, patch });
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token ?? null;
    if (!token) {
      pushToast({ tone: 'error', message: 'Please sign in again.' });
      return;
    }

    const res = await fetch(`/api/booking/${encodeURIComponent(idStr)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ businessId, ...patch }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      pushToast({ tone: 'error', message: txt || 'Booking update failed.' });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['bookings', businessId] });
    await queryClient.invalidateQueries({ queryKey: ['booking_invoices', businessId] });
    await queryClient.invalidateQueries({ queryKey: ['transactions', businessId] });
    pushToast({ tone: 'ok', message: 'Booking updated.' });
  }

  function computeBookingPaid(b: any): boolean {
    if (!b) return false;
    const st = String((b as any)?.status ?? '').toLowerCase();
    return st === 'paid' || st === 'completed';
  }

  function optimisticUpdateBookingInCache(updated: any) {
    if (!businessId || !updated?.id) return;
    queryClient.setQueriesData({ queryKey: ['bookings', businessId] }, (old: any) => {
      const rows = (old ?? []) as any[];
      if (!Array.isArray(rows)) return old;
      return rows.map((r) => (String(r?.id) === String(updated.id) ? { ...r, ...updated } : r));
    });
  }

  async function toggleBookingPaid(booking: any, nextPaid: boolean) {
    if (!businessId) {
      pushToast({ tone: 'error', message: 'Missing business. Please reload.' });
      return;
    }
    const bookingId = String(booking?.id ?? '').trim();
    if (!bookingId) {
      pushToast({ tone: 'error', message: 'Missing booking id.' });
      return;
    }

    // Some DBs allow status='paid'. Others only allow 'completed'. Be schema-safe.
    const nextStatusPrimary = nextPaid ? 'paid' : 'confirmed';
    const nextStatusFallback = nextPaid ? 'completed' : 'pending';

    // Optimistic: update active booking + cache immediately.
    const optimistic = { ...booking, status: nextStatusPrimary };
    setActiveBooking((prev: any) => (prev && String(prev.id) === bookingId ? optimistic : prev));
    optimisticUpdateBookingInCache(optimistic);

    const patches = [{ status: nextStatusPrimary }, { status: nextStatusFallback }];
    let saved: any | null = null;
    let lastErr: any | null = null;
    for (const patch of patches) {
      const { data, error } = await supabase
        .from('bookings')
        .update(patch as any)
        .eq('business_id', businessId)
        .eq('id', bookingId as any)
        .select('*')
        .single();

      // eslint-disable-next-line no-console
      console.log('BOOKING_TOGGLE_PAID_UPDATE_RESULT', { bookingId, patch, data, error });

      if (!error && data) {
        saved = data;
        lastErr = null;
        break;
      }
      lastErr = error ?? new Error('Booking update failed');
    }

    if (lastErr) {
      // Revert optimistic update if we failed.
      setActiveBooking((prev: any) => (prev && String(prev.id) === bookingId ? booking : prev));
      optimisticUpdateBookingInCache(booking);
      pushToast({
        tone: 'error',
        message: String((lastErr as any)?.message ?? 'Booking payment update failed.'),
      });
      return;
    }

    if (saved) {
      setActiveBooking((prev: any) => (prev && String(prev.id) === bookingId ? saved : prev));
      optimisticUpdateBookingInCache(saved);
    }

    await queryClient.invalidateQueries({ queryKey: ['bookings', businessId] });
    pushToast({ tone: 'ok', message: nextPaid ? 'Marked booking paid.' : 'Marked booking unpaid.' });
  }

  async function deleteBooking(id: string | number) {
    if (!businessId) {
      pushToast({ tone: 'error', message: 'Missing business. Please reload.' });
      return;
    }
    const idStr = String(id ?? '').trim();
    if (!idStr) {
      pushToast({ tone: 'error', message: 'Invalid booking id.' });
      return;
    }
    // eslint-disable-next-line no-console
    console.log('BOOKING_DELETE_ID', { id: idStr });

    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token ?? null;
    if (!token) {
      pushToast({ tone: 'error', message: 'Please sign in again.' });
      return;
    }

    const res = await fetch(`/api/booking/${encodeURIComponent(idStr)}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ businessId }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      pushToast({ tone: 'error', message: txt || 'Booking delete failed.' });
      return;
    }

    await queryClient.invalidateQueries({ queryKey: ['bookings', businessId] });
    await queryClient.invalidateQueries({ queryKey: ['booking_invoices', businessId] });
    await queryClient.invalidateQueries({ queryKey: ['transactions', businessId] });
    pushToast({ tone: 'ok', message: 'Booking cancelled.' });
  }

  async function handleCreateBooking() {
    const issues: string[] = [];
    setCreateErrors([]);

    if (!businessId || !isUuid(businessId)) issues.push('Select a valid business.');

    const serviceIdStr = String(createServiceId ?? '').trim();
    if (!serviceIdStr) issues.push('Choose a service.');
    else if (!isUuid(serviceIdStr)) issues.push('Selected service is invalid. Please re-select.');

    if (!createStartIso) issues.push('Enter a valid start date/time.');
    else if (Number.isNaN(new Date(createStartIso).getTime())) issues.push('Start date/time is invalid.');

    const customerKey = createCustomerId ? String(createCustomerId).trim() : null;
    const selectedCustomer = customerKey ? (customerById.get(String(customerKey)) ?? null) : null;
    if (!selectedCustomer) {
      issues.push('Choose a customer.');
    } else {
      const nm = String(selectedCustomer?.name ?? '').trim();
      const em = String(selectedCustomer?.email ?? '').trim();
      if (!nm) issues.push('Customer is missing a name.');
      if (!em) issues.push('Customer is missing an email.');
    }

    if (issues.length) {
      setCreateErrors(issues);
      return;
    }

    const startIso = createStartIso;

    try {
      setCreateSaving(true);
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? null;
      if (!token) throw new Error('Not signed in');

      // Normalize payload so we never send nulls for required columns.
      const normalizedCustomerName = String(selectedCustomer?.name ?? '').trim();
      const normalizedCustomerEmail = String(selectedCustomer?.email ?? '').trim();
      const normalizedCustomerPhone = String(selectedCustomer?.phone ?? '').trim();
      const normalizedNotes = String(createNotes ?? '').trim();

      const payload = {
        businessId,
        serviceId: serviceIdStr,
        customer_name: normalizedCustomerName,
        customer_email: normalizedCustomerEmail,
        customer_phone: normalizedCustomerPhone,
        startAt: startIso,
        notes: normalizedNotes,
        status: 'pending',
      };
      // eslint-disable-next-line no-console
      console.log('BOOKING_CREATE_PAYLOAD', payload);

      const res = await fetch('/api/booking/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        // eslint-disable-next-line no-console
        console.log('BOOKING_CREATE_NON_OK', { status: res.status, txt });
        try {
          const j = JSON.parse(txt);
          const err = (j as any)?.error ?? null;
          if (err && typeof err === 'object') {
            const code = (err as any)?.code ?? null;
            const msg = (err as any)?.message ?? (err as any)?.error ?? null;
            const details = (err as any)?.details ?? null;
            throw new Error(
              `Could not create booking.\n` +
                `code: ${code ?? 'n/a'}\n` +
                `message: ${msg ?? 'n/a'}\n` +
                `details: ${details ?? 'n/a'}`
            );
          }
          throw new Error(String(err ?? txt ?? 'Could not create booking.'));
        } catch {
          throw new Error(txt || 'Could not create booking.');
        }
      }

      const json = await res.json().catch(() => null);
      // eslint-disable-next-line no-console
      console.log('BOOKING_CREATE_OK', json);

      setCreateOpen(false);
      setCreateNotes('');
      setCreateCustomerId(null);
      setCreateServiceId(null);
      setCreateStartDigits('');
      setCreateStartAmPm('AM');
      setCreateErrors([]);

      await queryClient.invalidateQueries({ queryKey: ['bookings', businessId] });
      await queryClient.invalidateQueries({ queryKey: ['booking_invoices', businessId] });
    } catch (e: any) {
      const msg = String(e?.message ?? 'Could not create booking.');
      setCreateErrors(msg.split('\n').filter(Boolean));
    } finally {
      setCreateSaving(false);
    }
  }

  const bookings = (bookingsQ.data ?? []) as any[];
  const listTotalPages = Math.max(1, Math.ceil(bookings.length / listPageSize));
  useEffect(() => {
    if (listPage > listTotalPages) setListPage(listTotalPages);
    if (listPage < 1) setListPage(1);
  }, [listPage, listTotalPages]);
  const listRows = useMemo(() => {
    const start = (listPage - 1) * listPageSize;
    return bookings.slice(start, start + listPageSize);
  }, [bookings, listPage]);
  const loading = servicesQ.isLoading || bookingsQ.isLoading;
  const error = (servicesQ.error as any)?.message ?? (bookingsQ.error as any)?.message ?? null;

  return (
    <main className="max-w-6xl mx-auto px-6 py-6 space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
          Bookings
        </h1>
        <p className="text-slate-400 text-sm">
          Calendar + auto-invoices
        </p>
      </header>

      {/* Top stats */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard icon={<Clock className="h-4 w-4 text-emerald-200" />} label="Upcoming" value={String(stats.upcoming)} />
        <StatCard icon={<CalendarRange className="h-4 w-4 text-sky-200" />} label="This Week" value={String(stats.thisWeek)} />
        <StatCard
          icon={<DollarSign className="h-4 w-4 text-violet-200" />}
          label="Revenue Scheduled"
          value={Number(stats.revenueScheduled || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
        />
      </section>

      {/* Tabs + actions */}
      <section className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-3 shadow-[0_1px_0_rgba(255,255,255,0.04)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <TabButton is_active={tab === 'calendar'} onClick={() => setTab('calendar')} icon={<CalendarDays className="h-4 w-4" />}>
              Calendar
            </TabButton>
            <TabButton is_active={tab === 'list'} onClick={() => setTab('list')} icon={<List className="h-4 w-4" />}>
              List
            </TabButton>
            <TabButton is_active={tab === 'services'} onClick={() => setTab('services')} icon={<SlidersHorizontal className="h-4 w-4" />}>
              Services
            </TabButton>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
            >
              <Plus className="h-4 w-4" />
              New booking
            </button>
          </div>
        </div>
      </section>

      {/* Main content */}
      <section className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-3 shadow-[0_1px_0_rgba(255,255,255,0.04)]">
        {loading ? (
          <div className="text-sm text-slate-400">Loading bookings…</div>
        ) : error ? (
          <div className="text-sm text-rose-200">
            {error}
            <div className="mt-1 text-xs text-slate-400">
              If this is your first time, run `supabase/bookings.sql` in Supabase SQL Editor, then refresh.
            </div>
          </div>
        ) : tab === 'calendar' ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFocusDate((d) => {
                    const x = new Date(d);
                    x.setMonth(x.getMonth() - 1);
                    return x;
                  })}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => setFocusDate(new Date())}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setFocusDate((d) => {
                    const x = new Date(d);
                    x.setMonth(x.getMonth() + 1);
                    return x;
                  })}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
                >
                  →
                </button>
                <div className="ml-2 text-sm font-semibold text-slate-100">
                  {focusDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </div>
              </div>

              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                Month view
              </div>
            </div>

            {bookings.length === 0 ? (
              <EmptyCard
                icon={<LayoutGrid className="h-5 w-5 text-slate-300/80" />}
                title="No bookings yet"
                subtitle="Create your first booking to see it on the calendar."
              />
            ) : (
              <CalendarView
                focusDate={focusDate}
                bookings={bookings}
                bookingsByDay={bookingsByDay}
                onSelectDay={(dayKey) => {
                  setDayPanelKey(dayKey);
                  setDayPanelOpen(true);
                }}
              />
            )}
          </div>
        ) : tab === 'list' ? (
          bookings.length === 0 ? (
            <EmptyCard
              icon={<List className="h-5 w-5 text-slate-300/80" />}
              title="No bookings yet"
              subtitle="Bookings will show here once you create them."
            />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-slate-400">
                  Showing {(listPage - 1) * listPageSize + 1}–{Math.min(listPage * listPageSize, bookings.length)} of {bookings.length}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setListPage((p) => Math.max(1, p - 1))}
                    disabled={listPage <= 1}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50"
                  >
                    Prev
                  </button>
                  <div className="text-xs text-slate-400 tabular-nums">
                    Page {listPage} / {listTotalPages}
                  </div>
                  <button
                    type="button"
                    onClick={() => setListPage((p) => Math.min(listTotalPages, p + 1))}
                    disabled={listPage >= listTotalPages}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>

              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full text-left">
                <thead className="bg-slate-950/40 text-slate-300 border-b border-white/10">
                  <tr>
                    <th className="px-3 py-2 text-[11px] uppercase tracking-[0.18em]">When</th>
                    <th className="px-3 py-2 text-[11px] uppercase tracking-[0.18em]">Customer</th>
                    <th className="px-3 py-2 text-[11px] uppercase tracking-[0.18em]">Service</th>
                    <th className="px-3 py-2 text-[11px] uppercase tracking-[0.18em]">Invoice</th>
                    <th className="px-3 py-2 text-[11px] uppercase tracking-[0.18em]">Paid</th>
                    <th className="px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {listRows.map((b) => {
                    const when = safeWhenLabel(b?.start_at);
                    const cust = String(b.customer_name ?? '').trim() || '—';
                    const svc = b.service_id ? serviceById.get(String(b.service_id))?.name : '—';
                    const inv = invoiceByBookingId.get(String(b.id));
                    const paid = computeBookingPaid(b);
                    return (
                      <tr key={b.id} className="border-t border-white/10 hover:bg-white/[0.04]">
                        <td className="px-3 py-2 text-sm text-slate-200">{when}</td>
                        <td className="px-3 py-2 text-sm text-slate-200">{cust}</td>
                        <td className="px-3 py-2 text-sm text-slate-200">{svc}</td>
                        <td className="px-3 py-2 text-sm text-slate-300">
                          {inv ? (
                            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200">
                              {inv.invoice_number} • {inv.status}
                            </span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            disabled={paidBusyId === String(b.id)}
                            onClick={async () => {
                              if (!b?.id) return;
                              const nextPaid = !paid;
                              // eslint-disable-next-line no-console
                              console.log('BOOKING_LIST_TOGGLE_PAID', { bookingId: String(b.id), nextPaid });
                              try {
                                setPaidBusyId(String(b.id));
                                await toggleBookingPaid(b, nextPaid);
                              } catch (e: any) {
                                pushToast({ tone: 'error', message: String(e?.message ?? 'Could not update booking.') });
                              } finally {
                                setPaidBusyId(null);
                              }
                            }}
                            className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-semibold transition ${
                              paid
                                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15'
                                  : 'border-amber-500/30 bg-amber-500/10 text-amber-100 hover:bg-amber-500/15'
                            } ${paidBusyId === String(b.id) ? 'opacity-60' : ''}`}
                            title={paid ? 'Click to mark unpaid' : 'Click to mark paid'}
                          >
                            {paidBusyId === String(b.id) ? 'Saving…' : paid ? 'Paid' : 'Unpaid'}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => openBooking(b)}
                            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
                          >
                            Open
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

              {/* Mobile card list */}
              <div className="md:hidden space-y-3">
                {listRows.map((b) => {
                  const when = safeWhenLabel(b?.start_at);
                  const cust = String(b.customer_name ?? '').trim() || '—';
                  const svc = b.service_id ? serviceById.get(String(b.service_id))?.name : '—';
                  const inv = invoiceByBookingId.get(String(b.id));
                  const paid = computeBookingPaid(b);
                  return (
                    <div
                      key={String(b.id)}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-100 truncate">{cust}</div>
                          <div className="mt-1 text-[11px] text-slate-400">{when}</div>
                          <div className="mt-1 text-[11px] text-slate-400 truncate">
                            Service: <span className="text-slate-200">{svc}</span>
                          </div>
                          <div className="mt-2">
                            {inv ? (
                              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200">
                                {inv.invoice_number} • {inv.status}
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-500">No invoice</span>
                            )}
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={paidBusyId === String(b.id)}
                          onClick={async () => {
                            if (!b?.id) return;
                            const nextPaid = !paid;
                            // eslint-disable-next-line no-console
                            console.log('BOOKING_LIST_TOGGLE_PAID', { bookingId: String(b.id), nextPaid });
                            try {
                              setPaidBusyId(String(b.id));
                              await toggleBookingPaid(b, nextPaid);
                            } catch (e: any) {
                              pushToast({ tone: 'error', message: String(e?.message ?? 'Could not update booking.') });
                            } finally {
                              setPaidBusyId(null);
                            }
                          }}
                          className={`shrink-0 inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                            paid
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15'
                              : 'border-amber-500/30 bg-amber-500/10 text-amber-100 hover:bg-amber-500/15'
                          } ${paidBusyId === String(b.id) ? 'opacity-60' : ''}`}
                          title={paid ? 'Tap to mark unpaid' : 'Tap to mark paid'}
                        >
                          {paidBusyId === String(b.id) ? 'Saving…' : paid ? 'Paid' : 'Unpaid'}
                        </button>
                      </div>

                      <div className="mt-3 flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openBooking(b)}
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
                        >
                          Open
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )
        ) : tab === 'services' ? (
          <ServicesPanel businessId={businessId} services={servicesQ.data ?? []} />
        ) : null}
      </section>

      {/* Right drawer */}
      {drawerOpen && activeBooking && (
        <BookingDrawer
          booking={activeBooking}
          onClose={() => {
            setDrawerOpen(false);
            setActiveBooking(null);
          }}
          customerName={String(activeBooking.customer_name ?? '').trim() || 'Customer'}
          serviceName={activeBooking.service_id ? serviceById.get(String(activeBooking.service_id))?.name ?? 'Service' : 'Service'}
          invoice={invoiceByBookingId.get(String(activeBooking.id)) ?? null}
          onViewInvoice={() => router.push('/invoices')}
          isPaid={computeBookingPaid(activeBooking)}
          paidBusy={paidBusyId === String(activeBooking.id)}
          onTogglePaid={async (nextPaid) => {
            if (!activeBooking?.id) {
              pushToast({ tone: 'error', message: 'Invalid booking id.' });
              return;
            }
            // eslint-disable-next-line no-console
            console.log('BOOKING_DRAWER_TOGGLE_PAID', { bookingId: String(activeBooking.id), nextPaid });
            try {
              setPaidBusyId(String(activeBooking.id));
              await toggleBookingPaid(activeBooking, nextPaid);
            } finally {
              setPaidBusyId(null);
            }
          }}
          onCancel={async () => {
            if (!activeBooking?.id) {
              pushToast({ tone: 'error', message: 'Invalid booking id.' });
              return;
            }
            await deleteBooking(String(activeBooking.id));
            setDrawerOpen(false);
            setActiveBooking(null);
          }}
          onReschedule={async (nextIso) => {
            if (!activeBooking?.id) {
              pushToast({ tone: 'error', message: 'Invalid booking id.' });
              return;
            }
            await patchBooking(String(activeBooking.id), { startAt: nextIso });
            setDrawerOpen(false);
          }}
        />
      )}

      {dayPanelOpen && dayPanelKey && (
        <DayBookingsPanel
          dayKey={dayPanelKey}
          bookings={bookingsByDay.get(dayPanelKey) ?? []}
          onClose={() => {
            setDayPanelOpen(false);
            setDayPanelKey(null);
          }}
          onSelectBooking={(b) => {
            setDayPanelOpen(false);
            setDayPanelKey(null);
            openBooking(b);
          }}
        />
      )}

      {/* Create modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-950/90 p-6 shadow-2xl backdrop-blur">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Bookings</div>
                <div className="mt-2 text-lg font-semibold text-slate-50 tracking-tight">New booking</div>
                <div className="mt-1 text-sm text-slate-300">Creates a booking + calendar event + invoice.</div>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {createErrors.length > 0 && (
              <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                <div className="text-[11px] uppercase tracking-[0.18em] opacity-80">Fix these</div>
                <ul className="mt-2 list-disc pl-5 space-y-1 text-sm">
                  {createErrors.map((e, idx) => (
                    <li key={`${idx}-${e}`}>{e}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4 grid gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Service</div>
                <select
                  style={{ colorScheme: 'dark' }}
                  value={createServiceId ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCreateServiceId(v ? v : null);
                  }}
                  className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 text-sm text-slate-100"
                >
                  <option value="" className="bg-slate-950 text-slate-100">Choose…</option>
                  {(servicesQ.data ?? []).map((s: any) => (
                    <option key={s.id} value={String(s.id)} className="bg-slate-950 text-slate-100">
                  {s.name} • ${(Number(s.price_cents || 0) / 100).toFixed(2)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Customer</div>
                <select
                  style={{ colorScheme: 'dark' }}
                  value={createCustomerId ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCreateCustomerId(v ? v : null);
                  }}
                  className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 text-sm text-slate-100"
                >
                  <option value="" className="bg-slate-950 text-slate-100">Optional…</option>
                  {((customers as any[]) ?? []).map((c: any) => (
                    <option key={c.id} value={String(c.id)} className="bg-slate-950 text-slate-100">
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Start time</div>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="MM/DD/YYYY · HH:MM AM"
                    value={createStartDigits ? formatMaskedStart(createStartDigits, createStartAmPm) : ''}
                    onKeyDown={(e) => {
                      const k = e.key;
                      if (k === 'Backspace') {
                        e.preventDefault();
                        setCreateStartDigits((prev) => String(prev ?? '').slice(0, -1));
                        return;
                      }
                      if (k === 'Tab' || k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End') return;
                      // Allow digits only; block free typing of punctuation/letters.
                      if (/^\d$/.test(k)) return;
                      e.preventDefault();
                    }}
                    onPaste={(e) => {
                      e.preventDefault();
                      const txt = e.clipboardData.getData('text') ?? '';
                      const digits = String(txt).replace(/\D/g, '').slice(0, 12);
                      if (!digits) return;
                      setCreateStartDigits(digits);
                    }}
                    onChange={(e) => {
                      // Fallback: if browser inserts something, keep only digits.
                      const digits = String(e.target.value ?? '').replace(/\D/g, '').slice(0, 12);
                      setCreateStartDigits(digits);
                    }}
                    className={`h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-100 placeholder:text-slate-500 transition-opacity ${
                      createStartDigits ? 'opacity-100' : 'opacity-70'
                    } focus:opacity-100`}
                  />
                  <div className="flex shrink-0 rounded-xl border border-white/10 bg-white/5 p-1">
                    <button
                      type="button"
                      onClick={() => setCreateStartAmPm('AM')}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                        createStartAmPm === 'AM' ? 'bg-white/10 text-slate-50' : 'text-slate-300 hover:bg-white/5'
                      }`}
                    >
                      AM
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreateStartAmPm('PM')}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                        createStartAmPm === 'PM' ? 'bg-white/10 text-slate-50' : 'text-slate-300 hover:bg-white/5'
                      }`}
                    >
                      PM
                    </button>
                  </div>
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  {createStartIso ? `Saved as timestamptz · ${formatLocalPretty(createStartIso)}` : 'Enter a valid date/time to continue.'}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Notes</div>
                <textarea
                  value={createNotes}
                  onChange={(e) => setCreateNotes(e.target.value)}
                  rows={3}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100"
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreateBooking()}
                disabled={createSaving}
                className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                {createSaving ? 'Creating…' : 'Create booking'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile primary action */}
      {!createOpen && !drawerOpen && !dayPanelOpen ? (
        <MobileFab onClick={() => setCreateOpen(true)} label="New booking" />
      ) : null}
    </main>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4 shadow-[0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-50 tracking-tight tabular-nums">
        {value}
      </div>
    </div>
  );
}

function TabButton({
  is_active,
  onClick,
  icon,
  children,
}: {
  is_active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition ${
        is_active ? 'bg-white/10 text-slate-50' : 'text-slate-300 hover:bg-white/5'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function EmptyCard({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-10 text-center">
      <div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
        {icon}
      </div>
      <div className="mt-3 text-lg font-semibold text-slate-50 tracking-tight">{title}</div>
      <div className="mt-1 text-sm text-slate-300">{subtitle}</div>
    </div>
  );
}

function CalendarView({
  focusDate,
  bookings,
  bookingsByDay,
  onSelectDay,
}: {
  focusDate: Date;
  bookings: any[];
  bookingsByDay: Map<string, any[]>;
  onSelectDay: (dayKey: string) => void;
}) {
  // Month-only view (no adjacent month days).
  const first = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1);
  const last = new Date(focusDate.getFullYear(), focusDate.getMonth() + 1, 0);
  const firstDow = first.getDay(); // 0=Sun
  const daysInMonth = last.getDate();

  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7; // pad to whole weeks
  const cells: Array<Date | null> = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(focusDate.getFullYear(), focusDate.getMonth(), day));
  while (cells.length < totalCells) cells.push(null);

  const headers = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="grid grid-cols-7 gap-2">
      {headers.map((h) => (
        <div key={h} className="px-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
          {h}
        </div>
      ))}
      {cells.map((d, idx) => {
        if (!d) {
          return <div key={`empty-${idx}`} className="rounded-xl border border-white/10 bg-white/[0.02] p-2" />;
        }
        const key = d.toISOString().slice(0, 10);
        const rows = bookingsByDay.get(key) ?? [];
        const todayKey = new Date().toISOString().slice(0, 10);
        const isToday = key === todayKey;

        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelectDay(key)}
            className="rounded-xl border border-white/10 bg-white/5 p-2 text-left hover:bg-white/10"
          >
            <div className="flex items-center justify-between">
              <div className={`text-[11px] ${isToday ? 'text-emerald-200' : 'text-slate-400'}`}>{d.getDate()}</div>
              <div />
            </div>
            <div className="mt-2 space-y-1">
              {rows.slice(0, 3).map((b) => (
                <div
                  key={b.id}
                  className="truncate rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-100"
                  title={String(b.customer_name ?? '')}
                >
                  {new Date(b.start_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} •{' '}
                  {String(b.customer_name ?? 'Customer')}
                </div>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function DayBookingsPanel({
  dayKey,
  bookings,
  onClose,
  onSelectBooking,
}: {
  dayKey: string;
  bookings: any[];
  onClose: () => void;
  onSelectBooking: (b: any) => void;
}) {
  const label = useMemo(() => {
    const d = new Date(`${dayKey}T00:00:00`);
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  }, [dayKey]);

  const sorted = useMemo(() => {
    return [...(bookings ?? [])].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  }, [bookings]);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-slate-950 border-l border-white/10 p-5 overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Day</div>
            <div className="mt-2 text-lg font-semibold text-slate-50 tracking-tight">{label}</div>
            <div className="mt-1 text-sm text-slate-300">
              {sorted.length === 0 ? 'No bookings.' : `${sorted.length} booking${sorted.length === 1 ? '' : 's'}`}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {sorted.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => onSelectBooking(b)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left hover:bg-white/10"
            >
              <div className="text-sm font-semibold text-slate-100">
                {safeTimeLabel(b?.start_at)} •{' '}
                {String(b.customer_name ?? 'Customer')}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                {String(b.status)}{b.notes ? ` • ${formatNotesInline(b.notes)}` : ''}
              </div>
            </button>
          ))}

          {sorted.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              No bookings on this day yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BookingDrawer({
  booking,
  customerName,
  serviceName,
  invoice,
  onClose,
  onViewInvoice,
  onCancel,
  onReschedule,
  isPaid,
  paidBusy,
  onTogglePaid,
}: {
  booking: any;
  customerName: string;
  serviceName: string;
  invoice: any | null;
  onClose: () => void;
  onViewInvoice: () => void;
  onCancel: () => Promise<void>;
  onReschedule: (nextIso: string) => Promise<void>;
  isPaid: boolean;
  paidBusy: boolean;
  onTogglePaid: (nextPaid: boolean) => Promise<void>;
}) {
  const [rescheduleDigits, setRescheduleDigits] = useState<string>('');
  const [rescheduleAmPm, setRescheduleAmPm] = useState<AmPm>('AM');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const startLabel = safeWhenLabel(booking?.start_at);
  const endLabel = safeTimeLabel(booking?.end_at);
  const rescheduleIso = useMemo(() => parseMaskedDigitsToIso(rescheduleDigits, rescheduleAmPm), [rescheduleDigits, rescheduleAmPm]);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-slate-950 border-l border-white/10 p-5 overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Booking</div>
            <div className="mt-2 text-lg font-semibold text-slate-50 tracking-tight">
              {serviceName}
            </div>
            <div className="mt-1 text-sm text-slate-300">
              {customerName}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-sm font-semibold text-slate-100">
            {startLabel} – {endLabel}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            Status: {String(booking.status)}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] text-slate-300">
              Payment:{' '}
              <span className={isPaid ? 'text-emerald-200' : 'text-amber-200'}>
                {isPaid ? 'Paid' : 'Unpaid'}
              </span>
            </div>
            <button
              type="button"
              disabled={busy || paidBusy}
              onClick={async () => {
                try {
                  setBusy(true);
                  setErr(null);
                  await onTogglePaid(!isPaid);
                } catch (e: any) {
                  setErr(e?.message ?? 'Failed to update booking payment status.');
                } finally {
                  setBusy(false);
                }
              }}
              className={`rounded-xl px-3 py-2 text-xs font-semibold transition disabled:opacity-50 ${
                isPaid ? 'border border-amber-500/30 bg-amber-500/10 text-amber-100 hover:bg-amber-500/15' : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
              }`}
            >
              {paidBusy ? 'Saving…' : isPaid ? 'Mark unpaid' : 'Mark paid'}
            </button>
          </div>
          {booking.notes && (
            <div className="mt-3 text-sm text-slate-200 leading-relaxed whitespace-pre-wrap break-words">
              {formatNotesForDisplay(booking.notes)}
            </div>
          )}
        </div>

        {invoice && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Invoice</div>
            <div className="mt-2 flex items-center justify-between">
              <div className="text-sm text-slate-200">
                {invoice.invoice_number} • {invoice.status}
              </div>
              <div className="text-sm font-semibold text-slate-50">${Number(invoice.total || 0).toFixed(2)}</div>
            </div>
            {invoice.amount_paid != null && (
              <div className="mt-1 text-[11px] text-slate-400">
                Paid: ${Number(invoice.amount_paid || 0).toFixed(2)} • Due:{' '}
                ${Number((invoice.balance_due ?? (Number(invoice.total || 0) - Number(invoice.amount_paid || 0))) || 0).toFixed(2)}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onViewInvoice}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
              >
                View
              </button>
            </div>
          </div>
        )}

        {err && (
          <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {err}
          </div>
        )}

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Actions</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                try {
                  setBusy(true);
                  setErr(null);
                  await onCancel();
                } catch (e: any) {
                  setErr(e?.message ?? 'Cancel failed.');
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100 hover:bg-rose-500/15 disabled:opacity-50"
            >
              Cancel booking
            </button>
          </div>

          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Reschedule</div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="MM/DD/YYYY h:mm AM"
                value={rescheduleDigits ? formatMaskedStartCompact(rescheduleDigits, rescheduleAmPm) : ''}
                onKeyDown={(e) => {
                  const k = e.key;
                  if (k === 'Backspace') {
                    e.preventDefault();
                    setRescheduleDigits((prev) => String(prev ?? '').slice(0, -1));
                    return;
                  }
                  if (k === 'Tab' || k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End') return;
                  if (/^\d$/.test(k)) return;
                  e.preventDefault();
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  const txt = e.clipboardData.getData('text') ?? '';
                  const digits = String(txt).replace(/\D/g, '').slice(0, 12);
                  if (!digits) return;
                  setRescheduleDigits(digits);
                }}
                onChange={(e) => {
                  const digits = String(e.target.value ?? '').replace(/\D/g, '').slice(0, 12);
                  setRescheduleDigits(digits);
                }}
                className={`h-10 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-100 placeholder:text-slate-500 transition-opacity ${
                  rescheduleDigits ? 'opacity-100' : 'opacity-70'
                } focus:opacity-100`}
              />
              <div className="flex shrink-0 rounded-xl border border-white/10 bg-white/5 p-1">
                <button
                  type="button"
                  onClick={() => setRescheduleAmPm('AM')}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                    rescheduleAmPm === 'AM' ? 'bg-white/10 text-slate-50' : 'text-slate-300 hover:bg-white/5'
                  }`}
                >
                  AM
                </button>
                <button
                  type="button"
                  onClick={() => setRescheduleAmPm('PM')}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                    rescheduleAmPm === 'PM' ? 'bg-white/10 text-slate-50' : 'text-slate-300 hover:bg-white/5'
                  }`}
                >
                  PM
                </button>
              </div>
              <button
                type="button"
                disabled={busy || !rescheduleIso}
                onClick={async () => {
                  try {
                    setBusy(true);
                    setErr(null);
                    if (!rescheduleIso) {
                      setErr('Invalid date/time.');
                      return;
                    }
                    await onReschedule(rescheduleIso);
                    setRescheduleDigits('');
                    setRescheduleAmPm('AM');
                  } catch (e: any) {
                    setErr(e?.message ?? 'Reschedule failed.');
                  } finally {
                    setBusy(false);
                  }
                }}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50"
              >
                Save
              </button>
            </div>
            <div className="mt-1 text-[11px] text-slate-400">
              {rescheduleIso ? `Will save as timestamptz · ${formatLocalPretty(rescheduleIso)}` : 'Enter a valid date/time to continue.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ServicesPanel({ businessId, services }: { businessId: string | null; services: any[] }) {
  const [name, setName] = useState('');
  const [durationHours, setDurationHours] = useState('');
  const [price, setPrice] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [lastSupabaseError, setLastSupabaseError] = useState<any | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const pageSize = 5;

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [editName, setEditName] = useState('');
  const [editDurationHours, setEditDurationHours] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);

  function hoursToMinutes(raw: string): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 60;
    // Allow decimals: 0.5, 1, 1.5, ...
    return Math.max(5, Math.round(n * 60));
  }

  function minutesToHuman(mins: number): string {
    const m = Math.max(0, Math.round(mins));
    const h = Math.floor(m / 60);
    const rem = m % 60;
    const parts: string[] = [];
    if (h > 0) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
    if (rem > 0) parts.push(`${rem} minute${rem === 1 ? '' : 's'}`);
    return parts.length ? parts.join(' ') : '0 minutes';
  }

  function minutesToHoursString(mins: any): string {
    const m = Number(mins ?? 0);
    if (!Number.isFinite(m) || m <= 0) return '';
    const h = m / 60;
    // keep user-friendly precision for common values (0.5, 1, 1.5, 2, ...)
    const rounded = Math.round(h * 100) / 100;
    return String(rounded);
  }

  function centsToDollarsString(cents: any): string {
    const c = Number(cents ?? 0);
    if (!Number.isFinite(c) || c <= 0) return '';
    return (c / 100).toFixed(2);
  }

  async function addService() {
    if (!businessId) {
      setErr('No business selected. Please select a business first.');
      return;
    }
    setErr(null);
    setLastSupabaseError(null);
    if (!name.trim()) {
      setErr('Service name is required.');
      return;
    }
    const mins = hoursToMinutes(durationHours);
    try {
      setSaving(true);
      const priceDollars = Number(String(price ?? '').replace(/[^0-9.]/g, '')) || 0;
      const priceCents = Math.max(0, Math.round(priceDollars * 100));
      const payload = {
        business_id: businessId,
        name: name.trim(),
        duration_minutes: mins,
        price_cents: priceCents,
        is_active: true,
      } as any;

      // eslint-disable-next-line no-console
      console.log('SERVICES_INSERT_PAYLOAD', payload);

      const { data, error } = await supabase
        .from('services')
        .insert(payload)
        .select('*')
        .single();

      // eslint-disable-next-line no-console
      console.log('SERVICES_INSERT_RESULT', { data, error });

      if (error || !data) {
        // eslint-disable-next-line no-console
        console.error('SUPABASE SERVICES INSERT ERROR', error);
        setLastSupabaseError(error ?? { message: 'No data returned from insert.' });
        const code = (error as any)?.code ?? null;
        const msg = (error as any)?.message ?? 'No data returned from insert.';
        const details = (error as any)?.details ?? null;
        const hint = (error as any)?.hint ?? null;
        setErr(
          `Could not save service.\n` +
            `code: ${code ?? 'n/a'}\n` +
            `message: ${msg}\n` +
            `details: ${details ?? 'n/a'}\n` +
            `hint: ${hint ?? 'n/a'}`
        );
        return;
      }
      setName('');
      setDurationHours('');
      setPrice('');
      setPage(1);
      await queryClient.invalidateQueries({ queryKey: ['services', businessId] });
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('SERVICES INSERT UNEXPECTED ERROR', e);
      setLastSupabaseError(e ?? null);
      const code = e?.code ?? null;
      const msg = e?.message ?? 'Could not save service.';
      const details = e?.details ?? null;
      const hint = e?.hint ?? null;
      setErr(
        `Could not save service.\n` +
          `code: ${code ?? 'n/a'}\n` +
          `message: ${msg}\n` +
          `details: ${details ?? 'n/a'}\n` +
          `hint: ${hint ?? 'n/a'}`
      );
    } finally {
      setSaving(false);
    }
  }

  function openEdit(service: any) {
    setErr(null);
    setLastSupabaseError(null);
    setEditing(service);
    setEditName(String(service?.name ?? ''));
    setEditDurationHours(minutesToHoursString(service?.duration_minutes));
    setEditPrice(centsToDollarsString(service?.price_cents));
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!businessId) {
      setErr('No business selected. Please select a business first.');
      return;
    }
    if (!editing?.id) {
      setErr('No service selected to edit.');
      return;
    }
    setErr(null);
    setLastSupabaseError(null);
    if (!String(editName ?? '').trim()) {
      setErr('Service name is required.');
      return;
    }

    const mins = hoursToMinutes(editDurationHours);
    const priceDollars = Number(String(editPrice ?? '').replace(/[^0-9.]/g, '')) || 0;
    const priceCents = Math.max(0, Math.round(priceDollars * 100));
    const payload = {
      name: String(editName ?? '').trim(),
      duration_minutes: mins,
      price_cents: priceCents,
    } as any;

    // eslint-disable-next-line no-console
    console.log('SERVICES_UPDATE_PAYLOAD', { id: editing.id, businessId, payload });

    try {
      setEditSaving(true);
      const { data, error } = await supabase
        .from('services')
        .update(payload)
        .eq('id', editing.id)
        .eq('business_id', businessId)
        .select('*')
        .single();

      // eslint-disable-next-line no-console
      console.log('SERVICES_UPDATE_RESULT', { data, error });

      if (error || !data) {
        // eslint-disable-next-line no-console
        console.error('SUPABASE SERVICES UPDATE ERROR', error);
        setLastSupabaseError(error ?? { message: 'No data returned from update.' });
        const code = (error as any)?.code ?? null;
        const msg = (error as any)?.message ?? 'No data returned from update.';
        const details = (error as any)?.details ?? null;
        const hint = (error as any)?.hint ?? null;
        setErr(
          `Could not update service.\n` +
            `code: ${code ?? 'n/a'}\n` +
            `message: ${msg}\n` +
            `details: ${details ?? 'n/a'}\n` +
            `hint: ${hint ?? 'n/a'}`
        );
        return;
      }

      setEditOpen(false);
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ['services', businessId] });
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('SERVICES UPDATE UNEXPECTED ERROR', e);
      setLastSupabaseError(e ?? null);
      const code = e?.code ?? null;
      const msg = e?.message ?? 'Could not update service.';
      const details = e?.details ?? null;
      const hint = e?.hint ?? null;
      setErr(
        `Could not update service.\n` +
          `code: ${code ?? 'n/a'}\n` +
          `message: ${msg}\n` +
          `details: ${details ?? 'n/a'}\n` +
          `hint: ${hint ?? 'n/a'}`
      );
    } finally {
      setEditSaving(false);
    }
  }

  function openDelete(service: any) {
    setErr(null);
    setLastSupabaseError(null);
    setDeleting(service);
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    if (!businessId) {
      setErr('No business selected. Please select a business first.');
      return;
    }
    if (!deleting?.id) {
      setErr('No service selected to delete.');
      return;
    }
    setErr(null);
    setLastSupabaseError(null);

    // eslint-disable-next-line no-console
    console.log('SERVICES_DELETE_REQUEST', { id: deleting.id, businessId });

    try {
      setDeleteSaving(true);
      // Soft-delete so existing bookings/invoices remain consistent; list filters out inactive services.
      const { data, error } = await supabase
        .from('services')
        .update({ is_active: false } as any)
        .eq('id', deleting.id)
        .eq('business_id', businessId)
        .select('*')
        .single();

      // eslint-disable-next-line no-console
      console.log('SERVICES_DELETE_RESULT', { data, error });

      if (error || !data) {
        // eslint-disable-next-line no-console
        console.error('SUPABASE SERVICES DELETE ERROR', error);
        setLastSupabaseError(error ?? { message: 'No data returned from delete.' });
        const code = (error as any)?.code ?? null;
        const msg = (error as any)?.message ?? 'No data returned from delete.';
        const details = (error as any)?.details ?? null;
        const hint = (error as any)?.hint ?? null;
        setErr(
          `Could not delete service.\n` +
            `code: ${code ?? 'n/a'}\n` +
            `message: ${msg}\n` +
            `details: ${details ?? 'n/a'}\n` +
            `hint: ${hint ?? 'n/a'}`
        );
        return;
      }

      setDeleteOpen(false);
      setDeleting(null);
      await queryClient.invalidateQueries({ queryKey: ['services', businessId] });
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('SERVICES DELETE UNEXPECTED ERROR', e);
      setLastSupabaseError(e ?? null);
      const code = e?.code ?? null;
      const msg = e?.message ?? 'Could not delete service.';
      const details = e?.details ?? null;
      const hint = e?.hint ?? null;
      setErr(
        `Could not delete service.\n` +
          `code: ${code ?? 'n/a'}\n` +
          `message: ${msg}\n` +
          `details: ${details ?? 'n/a'}\n` +
          `hint: ${hint ?? 'n/a'}`
      );
    } finally {
      setDeleteSaving(false);
    }
  }

  const durationHelper = useMemo(() => {
    const raw = String(durationHours ?? '').trim();
    if (!raw) return '1.5 = 1 hour 30 minutes';
    const mins = hoursToMinutes(raw);
    return `${raw} = ${minutesToHuman(mins)}`;
  }, [durationHours]);

  const sortedServices = useMemo(() => {
    return [...(services ?? [])].sort((a: any, b: any) => {
      const ta = new Date(a?.created_at ?? 0).getTime();
      const tb = new Date(b?.created_at ?? 0).getTime();
      return tb - ta;
    });
  }, [services]);

  const totalPages = Math.max(1, Math.ceil(sortedServices.length / pageSize));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
    if (page < 1) setPage(1);
  }, [page, totalPages]);

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedServices.slice(start, start + pageSize);
  }, [sortedServices, page]);

  return (
    <div className="space-y-6">
      {/* Edit modal */}
      {editOpen && (
        <div className="fixed inset-0 z-[60]">
          <button
            type="button"
            onClick={() => {
              if (editSaving) return;
              setEditOpen(false);
              setEditing(null);
            }}
            className="absolute inset-0 bg-slate-950/70"
            aria-label="Close edit service modal"
          />
          <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-slate-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Edit service</div>
                <div className="mt-1 truncate text-base font-semibold text-slate-50">{editing?.name ?? 'Service'}</div>
              </div>
              <button
                type="button"
                disabled={editSaving}
                onClick={() => {
                  setEditOpen(false);
                  setEditing(null);
                }}
                className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-200 hover:bg-white/10 disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Name</div>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="e.g. Weekly lawn care"
                  className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
              </div>

              <div className="sm:col-span-2">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Duration (Hours)</div>
                <input
                  value={editDurationHours}
                  onChange={(e) => setEditDurationHours(e.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. 1.5 hours"
                  className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
                <div className="mt-1 text-[11px] text-slate-400">
                  {(() => {
                    const raw = String(editDurationHours ?? '').trim();
                    if (!raw) return '1.5 = 1 hour 30 minutes';
                    const mins = hoursToMinutes(raw);
                    return `${raw} = ${minutesToHuman(mins)}`;
                  })()}
                </div>
              </div>

              <div className="sm:col-span-1">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Price</div>
                <input
                  value={editPrice}
                  onChange={(e) => setEditPrice(e.target.value)}
                  inputMode="decimal"
                  placeholder="$150"
                  className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={editSaving}
                onClick={() => {
                  setEditOpen(false);
                  setEditing(null);
                }}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={editSaving || !businessId}
                onClick={() => void saveEdit()}
                className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                {editSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteOpen && (
        <div className="fixed inset-0 z-[60]">
          <button
            type="button"
            onClick={() => {
              if (deleteSaving) return;
              setDeleteOpen(false);
              setDeleting(null);
            }}
            className="absolute inset-0 bg-slate-950/70"
            aria-label="Close delete confirmation"
          />
          <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-slate-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Delete service</div>
                <div className="mt-1 text-base font-semibold text-slate-50">Are you sure?</div>
              </div>
              <button
                type="button"
                disabled={deleteSaving}
                onClick={() => {
                  setDeleteOpen(false);
                  setDeleting(null);
                }}
                className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-200 hover:bg-white/10 disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 text-sm text-slate-300">
              This will hide <span className="font-semibold text-slate-100">{deleting?.name ?? 'this service'}</span> from your
              services list.
            </div>
            <div className="mt-1 text-xs text-slate-400">
              (We keep it as inactive so existing bookings/invoices remain consistent.)
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={deleteSaving}
                onClick={() => {
                  setDeleteOpen(false);
                  setDeleting(null);
                }}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteSaving || !businessId}
                onClick={() => void confirmDelete()}
                className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-100 hover:bg-rose-500/15 disabled:opacity-50"
              >
                {deleteSaving ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Form */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
              Add service
            </div>
            <div className="mt-1 text-sm text-slate-300">
              Duration is saved in minutes behind the scenes.
            </div>
          </div>
        </div>

        {err && (
          <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-rose-100">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.18em] opacity-80">
                  Error
                </div>
                <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-rose-100/95">
                  {err}
                </pre>
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const payload = JSON.stringify(lastSupabaseError ?? { message: err }, null, 2);
                    await navigator.clipboard.writeText(payload);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1200);
                  } catch {
                    // ignore
                  }
                }}
                className="shrink-0 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100 hover:bg-rose-500/15"
              >
                {copied ? 'Copied' : 'Copy error'}
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-1">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Name</div>
            <input
              id="rg-add-service-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Weekly lawn care"
              className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-100 opacity-80 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>

          <div className="sm:col-span-1">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
              Duration (Hours)
            </div>
            <input
              value={durationHours}
              onChange={(e) => setDurationHours(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 1.5 hours"
              className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-100 opacity-80 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
            <div className="mt-1 text-[11px] text-slate-400">
              {durationHelper}
            </div>
          </div>

          <div className="sm:col-span-1">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Price</div>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="$150"
              className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-100 opacity-80 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={saving || !businessId}
            onClick={() => void addService()}
            className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Add service'}
          </button>
        </div>
      </div>

      {/* List (below form) */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Services</div>
            <div className="mt-1 text-sm text-slate-300">
              {sortedServices.length === 0 ? 'No services yet.' : `${sortedServices.length} total`}
            </div>
          </div>

          {sortedServices.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50"
              >
                Prev
              </button>
              <div className="text-xs text-slate-400 tabular-nums">
                Page {page} / {totalPages}
              </div>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </div>

        {sortedServices.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-10 text-center">
            <div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
              <SlidersHorizontal className="h-5 w-5 text-slate-300/80" />
            </div>
            <div className="mt-3 text-lg font-semibold text-slate-50 tracking-tight">Add your first service</div>
            <div className="mt-1 text-sm text-slate-300">
              Create services so bookings can auto‑invoice the right amount.
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {pageRows.map((s: any) => {
              const mins = Number(s.duration_minutes || 60);
              return (
                <div
                  key={s.id}
                  className="group relative rounded-2xl border border-white/10 bg-white/5 px-4 py-3 transition-colors hover:bg-white/[0.07]"
                >
                  <div className="absolute right-3 top-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => openEdit(s)}
                      className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-200 hover:bg-white/10"
                      aria-label={`Edit service ${s.name}`}
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openDelete(s)}
                      className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-200 hover:bg-white/10"
                      aria-label={`Delete service ${s.name}`}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="text-sm font-semibold text-slate-100">{s.name}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    {minutesToHuman(mins)} • ${(Number(s.price_cents || 0) / 100).toFixed(2)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
