import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireActiveSubscription } from '../../../../lib/requireActiveSubscription';

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

function addMinutesIso(startIso: string, mins: number) {
  const d = new Date(startIso);
  return new Date(d.getTime() + mins * 60 * 1000).toISOString();
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireActiveSubscription(request);
  if (!(gate as any)?.ok) return gate as any;

  const token = getBearerToken(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const bookingId = Number(id);
  if (!Number.isFinite(bookingId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body: any = await request.json().catch(() => null);
  const businessId = String(body?.businessId ?? '');
  const status = body?.status ? String(body.status) : null;
  const startAt = body?.startAt ? String(body.startAt) : null;

  if (!businessId) return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
  if (startAt && !isIso(startAt)) return NextResponse.json({ error: 'startAt must be ISO' }, { status: 400 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } }
  );

  // Load booking + service duration
  const { data: booking, error: bErr } = await supabase
    .from('bookings')
    .select('id,business_id,service_id,start_at,end_at,status,invoice_id,services(duration_minutes)')
    .eq('business_id', businessId)
    .eq('id', bookingId)
    .single();
  if (bErr || !booking) return NextResponse.json({ error: bErr?.message ?? 'Not found' }, { status: 404 });

  const patch: any = {};
  if (status) patch.status = status;

  let nextStart = startAt;
  let nextEnd: string | null = null;
  if (startAt) {
    const dur = Number((booking as any)?.services?.duration_minutes) || 60;
    nextEnd = addMinutesIso(startAt, dur);

    // conflict check
    const { data: conflicts } = await supabase
      .from('bookings')
      .select('id')
      .eq('business_id', businessId)
      .neq('id', bookingId)
      .neq('status', 'cancelled')
      .lt('start_at', nextEnd)
      .gt('end_at', startAt)
      .limit(1);
    if ((conflicts ?? []).length > 0) {
      return NextResponse.json({ error: 'That time is no longer available.' }, { status: 409 });
    }

    patch.start_at = startAt;
    patch.end_at = nextEnd;
  }

  const { data: updated, error: uErr } = await supabase
    .from('bookings')
    .update(patch)
    .eq('business_id', businessId)
    .eq('id', bookingId)
    .select('*')
    .single();
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 400 });

  // Sync calendar event
  if (status === 'cancelled') {
    await supabase
      .from('calendar_events')
      .delete()
      .eq('business_id', businessId)
      .eq('booking_id', bookingId);
  } else {
    const calPatch: any = {};
    if (nextStart && nextEnd) {
      calPatch.start_at = nextStart;
      calPatch.end_at = nextEnd;
    }
    if (Object.keys(calPatch).length) {
      await supabase
        .from('calendar_events')
        .update(calPatch)
        .eq('business_id', businessId)
        .eq('booking_id', bookingId);
    }
  }

  // Optional: mark invoice overdue/paid handled via invoice actions on client; keep booking endpoint focused.
  return NextResponse.json({ booking: updated });
}


