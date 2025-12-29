import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireActiveSubscription } from '../../../../lib/requireActiveSubscription';
import { computeOpenSlots } from '../../../../lib/bookings/slots';

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

export async function POST(request: Request) {
  const gate = await requireActiveSubscription(request);
  if (!(gate as any)?.ok) return gate as any;

  const token = getBearerToken(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body: any = await request.json().catch(() => null);
  const businessId = String(body?.businessId ?? '');
  const fromIso = String(body?.from ?? body?.startAt ?? '');
  const toIso = String(body?.to ?? body?.endAt ?? '');
  const serviceId = body?.serviceId ?? null;

  if (!businessId) return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
  if (!isIso(fromIso) || !isIso(toIso)) {
    return NextResponse.json({ error: 'from/to must be ISO timestamps' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } }
  );

  // Load rules
  const { data: rules, error: rErr } = await supabase
    .from('availability_rules')
    .select('day_of_week,start_time,end_time,slot_minutes')
    .eq('business_id', businessId);
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 400 });

  // Resolve duration from service (optional)
  let durationMinutes = 60;
  if (serviceId) {
    const { data: svc, error: sErr } = await supabase
      .from('services')
      .select('duration_minutes')
      .eq('business_id', businessId)
      .eq('id', serviceId)
      .maybeSingle();
    if (!sErr && svc?.duration_minutes) durationMinutes = Number(svc.duration_minutes) || 60;
  }

  // Load existing bookings in range
  const { data: bookings, error: bErr } = await supabase
    .from('bookings')
    .select('id,start_at,end_at,status')
    .eq('business_id', businessId)
    .gte('start_at', fromIso)
    .lte('start_at', toIso);
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 400 });

  const slots = computeOpenSlots({
    fromIso,
    toIso,
    rules: (rules ?? []) as any[],
    bookings: (bookings ?? []) as any[],
    durationMinutes,
  });

  return NextResponse.json({ slots, durationMinutes });
}


