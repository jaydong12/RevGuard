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

export async function POST(request: Request) {
  const gate = await requireActiveSubscription(request);
  if (!(gate as any)?.ok) return gate as any;

  const token = getBearerToken(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body: any = await request.json().catch(() => null);
  const businessId = String(body?.businessId ?? '');
  const serviceId = Number(body?.serviceId);
  const customerId = body?.customerId === null || body?.customerId === undefined ? null : Number(body.customerId);
  const startAt = String(body?.startAt ?? '');
  const notes = String(body?.notes ?? '').trim() || null;

  if (!businessId) return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
  if (!Number.isFinite(serviceId)) return NextResponse.json({ error: 'serviceId is required' }, { status: 400 });
  if (!isIso(startAt)) return NextResponse.json({ error: 'startAt must be ISO timestamptz' }, { status: 400 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } }
  );

  // Load service (duration + price)
  const { data: svc, error: sErr } = await supabase
    .from('services')
    .select('id,name,duration_minutes,price')
    .eq('business_id', businessId)
    .eq('id', serviceId)
    .single();
  if (sErr || !svc) return NextResponse.json({ error: sErr?.message ?? 'Service not found' }, { status: 400 });

  const duration = Math.max(5, Number((svc as any).duration_minutes) || 60);
  const endAt = addMinutesIso(startAt, duration);

  // Check conflicts (simple overlap check)
  const { data: conflicts, error: cErr } = await supabase
    .from('bookings')
    .select('id,start_at,end_at,status')
    .eq('business_id', businessId)
    .neq('status', 'cancelled')
    .lt('start_at', endAt)
    .gt('end_at', startAt)
    .limit(1);
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 400 });
  if ((conflicts ?? []).length > 0) {
    return NextResponse.json({ error: 'That time is no longer available.' }, { status: 409 });
  }

  // Resolve customer name for invoice
  let clientName = 'Customer';
  if (customerId) {
    const { data: cust } = await supabase
      .from('customers')
      .select('id,name')
      .eq('business_id', businessId)
      .eq('id', customerId)
      .maybeSingle();
    if (cust?.name) clientName = String(cust.name);
  }

  // Create booking first
  const { data: booking, error: bErr } = await supabase
    .from('bookings')
    .insert({
      business_id: businessId,
      customer_id: customerId,
      service_id: serviceId,
      start_at: startAt,
      end_at: endAt,
      status: 'scheduled',
      notes,
    } as any)
    .select('*')
    .single();
  if (bErr || !booking) return NextResponse.json({ error: bErr?.message ?? 'Failed to create booking' }, { status: 400 });

  // Create calendar event
  const title = `${String((svc as any).name ?? 'Service')} • ${clientName}`;
  const { error: evErr } = await supabase.from('calendar_events').insert({
    business_id: businessId,
    booking_id: (booking as any).id,
    title,
    start_at: startAt,
    end_at: endAt,
    timezone: 'UTC',
  } as any);
  if (evErr) {
    // Non-fatal; booking still exists.
  }

  // Create invoice + item (auto-invoice)
  const invNum = `INV-${Date.now()}`;
  const issueDate = new Date().toISOString().slice(0, 10);
  const dueDate = issueDate;
  const price = Number((svc as any).price) || 0;
  const payload = {
    business_id: businessId,
    invoice_number: invNum,
    client_name: clientName,
    issue_date: issueDate,
    due_date: dueDate,
    status: 'sent',
    subtotal: price,
    tax: 0,
    total: price,
    notes: notes,
    source: 'booking',
    booking_id: (booking as any).id,
  };

  const { data: invoice, error: iErr } = await supabase
    .from('invoices')
    .insert(payload as any)
    .select('id,business_id,invoice_number,status,total')
    .single();
  if (!iErr && invoice?.id) {
    await supabase.from('invoice_items').insert({
      invoice_id: invoice.id,
      description: String((svc as any).name ?? 'Service'),
      quantity: 1,
      unit_price: price,
    } as any);

    await supabase
      .from('bookings')
      .update({ invoice_id: invoice.id } as any)
      .eq('id', (booking as any).id)
      .eq('business_id', businessId);
  }

  return NextResponse.json({
    booking,
    invoice: invoice ?? null,
  });
}


