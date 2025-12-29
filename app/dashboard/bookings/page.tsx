'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../utils/supabaseClient';
import { useAppData } from '../../../components/AppDataProvider';
import {
  CalendarDays,
  CalendarRange,
  Clock,
  DollarSign,
  Download,
  LayoutGrid,
  List,
  Plus,
  Settings2,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

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

export default function BookingsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { businessId, customers } = useAppData();

  type TabKey = 'calendar' | 'list' | 'services' | 'availability';
  type ViewKey = 'week' | 'month' | 'day';

  const [tab, setTab] = useState<TabKey>('calendar');
  const [view, setView] = useState<ViewKey>('week');
  const [focusDate, setFocusDate] = useState(() => new Date());

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeBooking, setActiveBooking] = useState<any | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createServiceId, setCreateServiceId] = useState<string | null>(null);
  const [createCustomerId, setCreateCustomerId] = useState<string | null>(null);
  const [createStartDigits, setCreateStartDigits] = useState<string>('');
  const [createStartAmPm, setCreateStartAmPm] = useState<AmPm>('AM');
  const [createNotes, setCreateNotes] = useState<string>('');
  const [createError, setCreateError] = useState<string | null>(null);
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
    if (view === 'day') {
      const s = new Date(focusDate);
      s.setHours(0, 0, 0, 0);
      const e = new Date(focusDate);
      e.setHours(23, 59, 59, 999);
      return { from: s, to: e };
    }
    if (view === 'month') return { from: startOfMonth(focusDate), to: endOfMonth(focusDate) };
    return { from: startOfWeek(focusDate), to: endOfWeek(focusDate) };
  }

  const { from, to } = useMemo(() => rangeForView(), [focusDate, view]);
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
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const availabilityQ = useQuery({
    queryKey: ['availability_rules', businessId],
    enabled: Boolean(businessId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('availability_rules')
        .select('*')
        .eq('business_id', businessId!)
        .order('day_of_week', { ascending: true });
      if (error) throw error;
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
      if (error) throw error;
      return (data ?? []) as any[];
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
      if (error) throw error;
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

  const stats = useMemo(() => {
    const all = (bookingsQ.data ?? []) as any[];
    const now = Date.now();
    const upcoming = all.filter((b) => String(b.status) === 'scheduled' && new Date(b.start_at).getTime() >= now).length;
    const weekFrom = startOfWeek(new Date()).getTime();
    const weekTo = endOfWeek(new Date()).getTime();
    const thisWeek = all.filter((b) => {
      const t = new Date(b.start_at).getTime();
      return String(b.status) === 'scheduled' && t >= weekFrom && t <= weekTo;
    }).length;

    let unpaid = 0;
    let revenueScheduled = 0;
    for (const b of all) {
      const inv = invoiceByBookingId.get(String(b.id));
      if (inv) {
        if (String(inv.status) !== 'paid') unpaid += 1;
        if (String(inv.status) !== 'paid') revenueScheduled += Number(inv.total) || 0;
      }
    }
    return { upcoming, thisWeek, unpaid, revenueScheduled };
  }, [bookingsQ.data, invoiceByBookingId]);

  function openBooking(b: any) {
    setActiveBooking(b);
    setDrawerOpen(true);
  }

  async function patchBooking(id: number, patch: any) {
    if (!businessId) return;
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token ?? null;
    if (!token) throw new Error('Not signed in');

    const res = await fetch(`/api/booking/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ businessId, ...patch }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(txt || 'Booking update failed');
    }
    await queryClient.invalidateQueries({ queryKey: ['bookings', businessId] });
    await queryClient.invalidateQueries({ queryKey: ['booking_invoices', businessId] });
  }

  async function handleDownloadIcs() {
    if (!businessId) return;
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token ?? null;
    if (!token) return;

    const url = `/api/booking/ics?businessId=${encodeURIComponent(businessId)}&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'revguard-bookings.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function handleCreateBooking() {
    setCreateError(null);
    if (!businessId || !isUuid(businessId)) {
      setCreateError('Select a valid business before creating a booking.');
      return;
    }
    const serviceIdStr = String(createServiceId ?? '').trim();
    if (!serviceIdStr || !isUuid(serviceIdStr)) {
      setCreateError('Choose a service.');
      return;
    }
    if (!createStartIso) {
      setCreateError('Choose a date/time.');
      return;
    }
    const customerKey = createCustomerId ? String(createCustomerId).trim() : null;
    const selectedCustomer = customerKey ? customerById.get(String(customerKey)) ?? null : null;
    if (customerKey && !selectedCustomer) {
      setCreateError('Customer selection is invalid. Please re-select.');
      return;
    }
    const startIso = createStartIso;

    try {
      setCreateSaving(true);
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? null;
      if (!token) throw new Error('Not signed in');

      const payload = {
        businessId,
        serviceId: serviceIdStr,
        customer_name: selectedCustomer?.name ? String(selectedCustomer.name) : null,
        customer_email: selectedCustomer?.email ? String(selectedCustomer.email) : null,
        customer_phone: selectedCustomer?.phone ? String(selectedCustomer.phone) : null,
        startAt: startIso,
        notes: createNotes.trim() || null,
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
          throw new Error(String(j?.error ?? txt ?? 'Could not create booking.'));
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

      await queryClient.invalidateQueries({ queryKey: ['bookings', businessId] });
      await queryClient.invalidateQueries({ queryKey: ['booking_invoices', businessId] });
    } catch (e: any) {
      setCreateError(e?.message ?? 'Could not create booking.');
    } finally {
      setCreateSaving(false);
    }
  }

  const bookings = (bookingsQ.data ?? []) as any[];
  const loading = servicesQ.isLoading || bookingsQ.isLoading;
  const error = (servicesQ.error as any)?.message ?? (bookingsQ.error as any)?.message ?? null;

  return (
    <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
          Bookings
        </h1>
        <p className="text-slate-400 text-sm">
          Calendar + auto-invoices
        </p>
      </header>

      {/* Top stats */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Clock className="h-4 w-4 text-emerald-200" />} label="Upcoming" value={String(stats.upcoming)} />
        <StatCard icon={<CalendarRange className="h-4 w-4 text-sky-200" />} label="This Week" value={String(stats.thisWeek)} />
        <StatCard icon={<DollarSign className="h-4 w-4 text-amber-200" />} label="Unpaid" value={String(stats.unpaid)} />
        <StatCard icon={<DollarSign className="h-4 w-4 text-violet-200" />} label="Revenue Scheduled" value={`$${Math.round(stats.revenueScheduled).toLocaleString('en-US')}`} />
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
            <TabButton is_active={tab === 'availability'} onClick={() => setTab('availability')} icon={<Settings2 className="h-4 w-4" />}>
              Availability
            </TabButton>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadIcs}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
              title="Download calendar"
            >
              <Download className="h-4 w-4" />
              Download .ics
            </button>
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
      <section className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4 shadow-[0_1px_0_rgba(255,255,255,0.04)]">
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
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFocusDate((d) => {
                    const x = new Date(d);
                    if (view === 'month') x.setMonth(x.getMonth() - 1);
                    else x.setDate(x.getDate() - (view === 'day' ? 1 : 7));
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
                    if (view === 'month') x.setMonth(x.getMonth() + 1);
                    else x.setDate(x.getDate() + (view === 'day' ? 1 : 7));
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

              <div className="flex items-center gap-2">
                <SegmentButton is_active={view === 'day'} onClick={() => setView('day')}>Day</SegmentButton>
                <SegmentButton is_active={view === 'week'} onClick={() => setView('week')}>Week</SegmentButton>
                <SegmentButton is_active={view === 'month'} onClick={() => setView('month')}>Month</SegmentButton>
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
                view={view}
                focusDate={focusDate}
                bookings={bookings}
                onSelectBooking={openBooking}
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
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead className="bg-slate-950/40 text-slate-300 border-b border-white/10">
                  <tr>
                    <th className="px-3 py-2 text-[11px] uppercase tracking-[0.18em]">When</th>
                    <th className="px-3 py-2 text-[11px] uppercase tracking-[0.18em]">Customer</th>
                    <th className="px-3 py-2 text-[11px] uppercase tracking-[0.18em]">Service</th>
                    <th className="px-3 py-2 text-[11px] uppercase tracking-[0.18em]">Invoice</th>
                    <th className="px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => {
                    const when = new Date(b.start_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                    const cust = String(b.customer_name ?? '').trim() || '—';
                    const svc = b.service_id ? serviceById.get(String(b.service_id))?.name : '—';
                    const inv = invoiceByBookingId.get(String(b.id));
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
          )
        ) : tab === 'services' ? (
          <ServicesPanel businessId={businessId} services={servicesQ.data ?? []} />
        ) : (
          <AvailabilityPanel businessId={businessId} rules={availabilityQ.data ?? []} />
        )}
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
          onMarkPaid={async () => {
            await patchBooking(Number(activeBooking.id), { markPaid: true });
          }}
          onCancel={async () => {
            await patchBooking(Number(activeBooking.id), { status: 'cancelled' });
            setDrawerOpen(false);
          }}
          onReschedule={async (nextIso) => {
            await patchBooking(Number(activeBooking.id), { startAt: nextIso });
            setDrawerOpen(false);
          }}
          onRecordPayment={async (amount) => {
            await patchBooking(Number(activeBooking.id), { paymentAmount: amount });
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

            {createError && (
              <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {createError}
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

function SegmentButton({
  is_active,
  onClick,
  children,
}: {
  is_active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
        is_active ? 'bg-white/10 text-slate-50' : 'border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
      }`}
    >
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
  view,
  focusDate,
  bookings,
  onSelectBooking,
}: {
  view: 'week' | 'month' | 'day';
  focusDate: Date;
  bookings: any[];
  onSelectBooking: (b: any) => void;
}) {
  const byDay = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const b of bookings) {
      const d = new Date(b.start_at);
      const key = d.toISOString().slice(0, 10);
      m.set(key, [...(m.get(key) ?? []), b]);
    }
    return m;
  }, [bookings]);

  if (view === 'day') {
    const k = new Date(focusDate).toISOString().slice(0, 10);
    const rows = byDay.get(k) ?? [];
    return (
      <div className="space-y-2">
        {rows.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onSelectBooking(b)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left hover:bg-white/10"
          >
            <div className="text-sm font-semibold text-slate-100">
              {new Date(b.start_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} • Booking #{b.id}
            </div>
            <div className="mt-1 text-xs text-slate-400">{String(b.status)}</div>
          </button>
        ))}
      </div>
    );
  }

  // week/month: simple grid, showing booking chips
  const days: Date[] = [];
  if (view === 'week') {
    const start = new Date(focusDate);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay());
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
  } else {
    const first = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
  }

  const cols = view === 'week' ? 7 : 7;
  return (
    <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {days.map((d) => {
        const key = d.toISOString().slice(0, 10);
        const rows = byDay.get(key) ?? [];
        const inMonth = d.getMonth() === focusDate.getMonth();
        return (
          <div key={key} className={`rounded-xl border border-white/10 bg-white/5 p-2 ${!inMonth && view === 'month' ? 'opacity-60' : ''}`}>
            <div className="flex items-center justify-between">
              <div className="text-[11px] text-slate-300 tabular-nums">{d.getDate()}</div>
              {rows.length > 0 && (
                <div className="text-[11px] text-slate-400">{rows.length}</div>
              )}
            </div>
            <div className="mt-2 space-y-1">
              {rows.slice(0, 3).map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onSelectBooking(b)}
                  className="w-full truncate rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-left text-[11px] text-emerald-100 hover:bg-emerald-500/15"
                >
                  {new Date(b.start_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} • #{b.id}
                </button>
              ))}
              {rows.length > 3 && <div className="text-[11px] text-slate-400">+{rows.length - 3} more</div>}
            </div>
          </div>
        );
      })}
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
  onMarkPaid,
  onCancel,
  onReschedule,
  onRecordPayment,
}: {
  booking: any;
  customerName: string;
  serviceName: string;
  invoice: any | null;
  onClose: () => void;
  onViewInvoice: () => void;
  onMarkPaid: () => Promise<void>;
  onCancel: () => Promise<void>;
  onReschedule: (nextIso: string) => Promise<void>;
  onRecordPayment: (amount: number) => Promise<void>;
}) {
  const [rescheduleLocal, setRescheduleLocal] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const startLabel = new Date(booking.start_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const endLabel = new Date(booking.end_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

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
          {booking.notes && (
            <div className="mt-3 text-sm text-slate-200 leading-relaxed">
              {booking.notes}
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
              {String(invoice.status) !== 'paid' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      setBusy(true);
                      setErr(null);
                      await onMarkPaid();
                    } catch (e: any) {
                      setErr(e?.message ?? 'Failed to mark paid.');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                >
                  Mark paid
                </button>
              )}
            </div>

            {String(invoice.status) !== 'paid' && (
              <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Record payment / deposit
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    placeholder="Amount"
                    inputMode="decimal"
                    className="h-10 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-100"
                  />
                  <button
                    type="button"
                    disabled={busy || !paymentAmount.trim()}
                    onClick={async () => {
                      try {
                        const n = Number(paymentAmount);
                        if (!Number.isFinite(n) || n <= 0) return;
                        setBusy(true);
                        setErr(null);
                        await onRecordPayment(n);
                        setPaymentAmount('');
                      } catch (e: any) {
                        setErr(e?.message ?? 'Failed to record payment.');
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50"
                  >
                    Apply
                  </button>
                </div>
              </div>
            )}
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
                type="datetime-local"
                value={rescheduleLocal}
                onChange={(e) => setRescheduleLocal(e.target.value)}
                className="h-10 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-100"
              />
              <button
                type="button"
                disabled={busy || !rescheduleLocal}
                onClick={async () => {
                  try {
                    setBusy(true);
                    setErr(null);
                    const iso = new Date(rescheduleLocal).toISOString();
                    await onReschedule(iso);
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

  const durationHelper = useMemo(() => {
    const raw = String(durationHours ?? '').trim();
    if (!raw) return '1.5 = 1 hour 30 minutes';
    const mins = hoursToMinutes(raw);
    return `${raw} = ${minutesToHuman(mins)}`;
  }, [durationHours]);

  return (
    <div className="space-y-6">
      {/* List */}
      {services.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-10 text-center">
          <div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
            <SlidersHorizontal className="h-5 w-5 text-slate-300/80" />
          </div>
          <div className="mt-3 text-lg font-semibold text-slate-50 tracking-tight">
            No services yet
          </div>
          <div className="mt-1 text-sm text-slate-300">
            Add your first service to start creating bookings and auto‑invoices.
          </div>
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => {
                try {
                  (document.getElementById('rg-add-service-name') as HTMLInputElement | null)?.focus?.();
                } catch {
                  // ignore
                }
              }}
              className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
            >
              Add your first service
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {services.map((s: any) => {
            const mins = Number(s.duration_minutes || 60);
            return (
              <div key={s.id} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-sm font-semibold text-slate-100">{s.name}</div>
                <div className="mt-1 text-xs text-slate-400">
                  {minutesToHuman(mins)} • ${(Number(s.price_cents || 0) / 100).toFixed(2)}
                </div>
              </div>
            );
          })}
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
    </div>
  );
}

function AvailabilityPanel({ businessId, rules }: { businessId: string | null; rules: any[] }) {
  const [dow, setDow] = useState('1');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [slot, setSlot] = useState('30');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dowLabel = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  async function addRule() {
    if (!businessId) return;
    setErr(null);
    try {
      setSaving(true);
      const { error } = await supabase.from('availability_rules').insert({
        business_id: businessId,
        day_of_week: Number(dow),
        start_time: start,
        end_time: end,
        slot_minutes: Number(slot) || 30,
        timezone: 'UTC',
      } as any);
      if (error) throw error;
    } catch (e: any) {
      setErr(e?.message ?? 'Could not save availability.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {rules.length === 0 ? (
        <EmptyCard
          icon={<Settings2 className="h-5 w-5 text-slate-300/80" />}
          title="No availability rules yet"
          subtitle="Add weekly hours so RevGuard can suggest open time slots."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rules.map((r: any) => (
            <div key={r.id} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="text-sm font-semibold text-slate-100">
                {dowLabel[Number(r.day_of_week) || 0]} • {String(r.start_time).slice(0, 5)}–{String(r.end_time).slice(0, 5)}
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Slot {Number(r.slot_minutes || 30)} min • {String(r.timezone || 'UTC')}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Add rule</div>
        {err && <div className="mt-2 text-sm text-rose-200">{err}</div>}
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <select
            style={{ colorScheme: 'dark' }}
            value={dow}
            onChange={(e) => setDow(e.target.value)}
            className="h-10 rounded-xl border border-white/10 bg-slate-950/60 px-3 text-sm text-slate-100"
          >
            {dowLabel.map((l, i) => (
              <option key={l} value={String(i)} className="bg-slate-950 text-slate-100">
                {l}
              </option>
            ))}
          </select>
          <input value={start} onChange={(e) => setStart(e.target.value)} className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-100" />
          <input value={end} onChange={(e) => setEnd(e.target.value)} className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-100" />
          <input value={slot} onChange={(e) => setSlot(e.target.value)} className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-100" />
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            disabled={saving || !businessId}
            onClick={() => void addRule()}
            className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}


