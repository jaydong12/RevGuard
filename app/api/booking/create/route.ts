import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireActiveSubscription } from '../../../../lib/requireActiveSubscription';
import { createSmartInvoiceForBooking } from '../../../../lib/smartInvoice';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function isIso(iso: any) {
  const s = String(iso ?? '');
  const d = new Date(s);
  return s && !Number.isNaN(d.getTime());
}

function isUuid(v: any): boolean {
  const s = String(v ?? '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function parsePositiveInt(v: any): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function serializeSupabaseError(err: any) {
  if (!err) return { message: 'Unknown error', code: null, details: null, hint: null };
  return {
    message: String(err?.message ?? err?.error_description ?? err?.error ?? 'Unknown error'),
    code: err?.code ?? null,
    details: err?.details ?? null,
    hint: err?.hint ?? null,
  };
}

function isMissingColumnError(err: any) {
  // Postgres undefined_column
  return String(err?.code ?? '') === '42703' || /column .* does not exist/i.test(String(err?.message ?? ''));
}

function addMinutesIso(startIso: string, mins: number) {
  const d = new Date(startIso);
  return new Date(d.getTime() + mins * 60 * 1000).toISOString();
}

export async function POST(request: Request) {
  const gate = await requireActiveSubscription(request);
  if (!(gate as any)?.ok) return gate as any;

  const token = getBearerToken(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body: any = await request.json().catch(() => null);
  const businessId = String(body?.businessId ?? '');
  const serviceId = String(body?.serviceId ?? '').trim();
  const customer_name = body?.customer_name ? String(body.customer_name).trim() : null;
  const customer_email = body?.customer_email ? String(body.customer_email).trim() : null;
  const customer_phone = body?.customer_phone ? String(body.customer_phone).trim() : null;
  const startAt = String(body?.startAt ?? '');
  const notes = String(body?.notes ?? '').trim() || null;
  const status = String(body?.status ?? 'pending').trim() || 'pending';

  if (!businessId || !isUuid(businessId)) return NextResponse.json({ error: 'businessId must be a valid UUID' }, { status: 400 });
  if (!serviceId || !isUuid(serviceId)) return NextResponse.json({ error: 'serviceId must be a valid UUID' }, { status: 400 });
  if (!isIso(startAt)) return NextResponse.json({ error: 'startAt must be ISO timestamptz' }, { status: 400 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnon) {
    return NextResponse.json(
      { error: 'Server is missing Supabase env vars (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).' },
      { status: 500 }
    );
  }

  const supabase = createClient(
    supabaseUrl,
    supabaseAnon,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } }
  );

  // Load service (duration + price_cents)
  const { data: svc, error: sErr } = await supabase
    .from('services')
    .select('id,name,duration_minutes,price_cents')
    .eq('business_id', businessId)
    .eq('id', serviceId)
    .single();
  if (sErr || !svc) return NextResponse.json({ error: serializeSupabaseError(sErr) }, { status: 400 });

  const duration = Math.max(5, Number((svc as any).duration_minutes) || 60);
  const endAt = addMinutesIso(startAt, duration);
  const svcPriceCents = Math.max(0, Number((svc as any).price_cents) || 0);

  // Check conflicts (simple overlap check)
  const { data: conflicts, error: cErr } = await supabase
    .from('bookings')
    .select('id,start_at,end_at,status')
    .eq('business_id', businessId)
    .neq('status', 'cancelled')
    .lt('start_at', endAt)
    .gt('end_at', startAt)
    .limit(1);
  if (cErr) return NextResponse.json({ error: serializeSupabaseError(cErr) }, { status: 400 });
  if ((conflicts ?? []).length > 0) {
    return NextResponse.json({ error: 'That time is no longer available.' }, { status: 409 });
  }

  // Customer fields are stored directly on the booking (no FK).
  const clientName = customer_name?.trim() ? String(customer_name).trim() : 'Customer';

  // Create booking + calendar event + invoice as one flow. If invoice creation fails, roll back booking/event.
  const bookingPayload: any = {
    business_id: businessId,
    service_id: serviceId,
    start_at: startAt,
    end_at: endAt,
    price_cents: svcPriceCents,
    status,
    notes: notes ?? '',
    customer_name: customer_name ?? '',
    customer_email: customer_email ?? '',
    customer_phone: customer_phone ?? '',
  };
  // eslint-disable-next-line no-console
  console.log('BOOKING_CREATE_SERVER_PAYLOAD', bookingPayload);

  // Schema-safe insert: some DBs may not have bookings.price_cents yet.
  let booking: any | null = null;
  {
    const { data: b1, error: bErr } = await supabase
      .from('bookings')
      .insert(bookingPayload)
      .select('*')
      .single();
    if (bErr && isMissingColumnError(bErr)) {
      const { price_cents: _omit, ...fallbackPayload } = bookingPayload;
      const { data: b2, error: bErr2 } = await supabase
        .from('bookings')
        .insert(fallbackPayload as any)
        .select('*')
        .single();
      if (bErr2 || !b2) return NextResponse.json({ error: serializeSupabaseError(bErr2) }, { status: 400 });
      booking = b2 as any;
    } else if (bErr || !b1) {
      return NextResponse.json({ error: serializeSupabaseError(bErr) }, { status: 400 });
    } else {
      booking = b1 as any;
    }
  }

  const title = `${String((svc as any).name ?? 'Service')} • ${clientName}`;
  const { data: ev, error: evErr } = await supabase
    .from('calendar_events')
    .insert({
      business_id: businessId,
      booking_id: (booking as any).id,
      title,
      start_at: startAt,
      end_at: endAt,
    } as any)
    .select('*')
    .single();

  if (evErr || !ev) {
    // Roll back booking if calendar event fails.
    await supabase.from('bookings').delete().eq('business_id', businessId).eq('id', (booking as any).id);
    return NextResponse.json({ error: serializeSupabaseError(evErr) }, { status: 400 });
  }

  try {
    const bookingPriceCents = Math.max(
      0,
      Number((booking as any)?.price_cents ?? NaN) || svcPriceCents || 0
    );
    const bookingPriceDollars = Number((bookingPriceCents / 100).toFixed(2));
    const invoice = await createSmartInvoiceForBooking({
      supabase,
      businessId,
      bookingId: Number((booking as any).id),
      clientName,
      serviceName: String((svc as any).name ?? 'Service'),
      // Important: use booking snapshot price (preferred) so invoice totals are always real for transaction sync.
      price: bookingPriceDollars,
      notes: notes,
      startAtIso: startAt,
      endAtIso: endAt,
    });

    const { error: linkErr } = await supabase
      .from('bookings')
      .update({ invoice_id: invoice.id } as any)
      .eq('id', (booking as any).id)
      .eq('business_id', businessId);
    if (linkErr) throw linkErr;

    return NextResponse.json({ booking, calendar_event: ev, invoice });
  } catch (e: any) {
    // Roll back calendar event + booking if invoice creation fails.
    await supabase.from('calendar_events').delete().eq('business_id', businessId).eq('id', (ev as any).id);
    await supabase.from('bookings').delete().eq('business_id', businessId).eq('id', (booking as any).id);
    // eslint-disable-next-line no-console
    console.error('BOOKING_CREATE_INVOICE_ERROR', e);
    return NextResponse.json({ error: serializeSupabaseError(e) }, { status: 400 });
  }
}


