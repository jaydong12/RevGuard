import Stripe from 'stripe';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toIsoFromUnixSeconds(secs: number | null | undefined): string | null {
  if (!secs || !Number.isFinite(secs)) return null;
  const ms = secs * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export async function POST(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secretKey || !webhookSecret) {
    return NextResponse.json(
      { error: 'Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET' },
      { status: 500 }
    );
  }

  const sig = request.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 }
    );
  }

  const stripe = new Stripe(secretKey);

  let event: Stripe.Event;
  try {
    const rawBody = await request.text();
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('STRIPE_WEBHOOK_SIGNATURE_INVALID', e);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Service-role Supabase client for webhook writes.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    null;

  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: 'Missing Supabase service role key' },
      { status: 500 }
    );
  }

  const supabaseAdmin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Subscription lifecycle events: link strictly by Stripe customer (cus_*), never email.
  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const sub = event.data.object as Stripe.Subscription;
    const customerId =
      typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
    if (!customerId) {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    const { data: biz, error: bizErr } = await supabaseAdmin
      .from('business')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .limit(1)
      .maybeSingle();

    if (bizErr || !biz?.id) {
      // Not found: ignore (could be a customer created outside this app).
      return NextResponse.json({ received: true }, { status: 200 });
    }

    const patch = {
      stripe_subscription_id: sub.id,
      subscription_status: sub.status ?? 'inactive',
      current_period_end: toIsoFromUnixSeconds((sub as any).current_period_end),
    };

    const { error: updErr } = await supabaseAdmin
      .from('business')
      .update(patch)
      .eq('id', biz.id);

    if (updErr) {
      // eslint-disable-next-line no-console
      console.error('STRIPE_WEBHOOK_BUSINESS_UPDATE_FAILED', updErr);
      return NextResponse.json({ error: 'Failed to update business' }, { status: 500 });
    }

    return NextResponse.json({ received: true }, { status: 200 });
  }

  // Ignore other event types (but acknowledge).
  return NextResponse.json({ received: true }, { status: 200 });
}


