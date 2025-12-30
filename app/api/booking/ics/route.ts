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

function escIcs(s: string) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function fmtUtcIcs(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${day}T${hh}${mm}${ss}Z`;
}

export async function GET(request: Request) {
  const gate = await requireActiveSubscription(request);
  if (!(gate as any)?.ok) return gate as any;

  const token = getBearerToken(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const businessId = String(url.searchParams.get('businessId') ?? '');
  const from = url.searchParams.get('from'); // ISO
  const to = url.searchParams.get('to'); // ISO
  if (!businessId) return NextResponse.json({ error: 'businessId is required' }, { status: 400 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } }
  );

  let q = supabase
    .from('calendar_events')
    .select('id,title,start_at,end_at,booking_id')
    .eq('business_id', businessId)
    .order('start_at', { ascending: true });
  if (from) q = q.gte('start_at', from);
  if (to) q = q.lte('start_at', to);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const now = fmtUtcIcs(new Date().toISOString());
  const lines: string[] = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//RevGuard//Bookings//EN');
  lines.push('CALSCALE:GREGORIAN');

  for (const ev of (data ?? []) as any[]) {
    const uid = `revguard-${businessId}-${String(ev.id)}@revguard`;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART:${fmtUtcIcs(String(ev.start_at))}`);
    lines.push(`DTEND:${fmtUtcIcs(String(ev.end_at))}`);
    lines.push(`SUMMARY:${escIcs(String(ev.title ?? 'Booking'))}`);
    lines.push(`DESCRIPTION:${escIcs(`Booking ${ev.booking_id ?? ''}`)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  const ics = lines.join('\r\n');
  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="revguard-bookings.ics"',
      'Cache-Control': 'no-store',
    },
  });
}


