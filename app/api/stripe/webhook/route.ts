import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getSupabaseAdmin } from '../../../../lib/server/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isoFromUnixSeconds(secs: number | null | undefined): string | null {
  if (!secs || !Number.isFinite(secs)) return null;
  const d = new Date(secs * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function getStringMeta(meta: any, key: string): string | null {
  const v = meta?.[key] ?? null;
  const s = String(v ?? '').trim();
  return s ? s : null;
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

  let supabaseAdmin: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Missing Supabase service role key' }, { status: 500 });
  }

  // Dedupe: insert event.id into stripe_events (ignore conflicts).
  try {
    const ins = await supabaseAdmin.from('stripe_events').insert({ id: event.id, type: event.type } as any);
    if (ins.error) {
      const code = String((ins.error as any)?.code ?? '');
      if (code === '23505') {
        return NextResponse.json({ received: true }, { status: 200 });
      }
      // If the table isn't migrated yet, don't crash prod webhooks.
      const msg = String((ins.error as any)?.message ?? '');
      if (!/stripe_events/i.test(msg)) {
        // eslint-disable-next-line no-console
        console.error('STRIPE_WEBHOOK_DEDUPE_FAILED', ins.error);
      }
    }
  } catch {
    // ignore dedupe failures
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const planId = getStringMeta((session as any).metadata, 'planId');
    const userId = getStringMeta((session as any).metadata, 'userId');
    const stripeCustomerId =
      typeof (session as any).customer === 'string' ? (session as any).customer : (session as any).customer?.id ?? null;
    const stripeSubscriptionId =
      typeof (session as any).subscription === 'string' ? (session as any).subscription : (session as any).subscription?.id ?? null;

    if (userId && stripeCustomerId) {
      let subStatus: string | null = null;
      let currentPeriodEnd: string | null = null;
      let cancelAtPeriodEnd = false;
      if (stripeSubscriptionId) {
        try {
          const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
          subStatus = String((sub as any).status ?? 'active');
          currentPeriodEnd = isoFromUnixSeconds((sub as any).current_period_end);
          cancelAtPeriodEnd = Boolean((sub as any).cancel_at_period_end);
        } catch {
          subStatus = 'active';
        }
      }

      await supabaseAdmin.from('subscriptions').upsert(
        {
          user_id: userId,
          plan_id: planId,
          status: subStatus ?? 'active',
          stripe_customer_id: stripeCustomerId,
          stripe_subscription_id: stripeSubscriptionId,
          current_period_end: currentPeriodEnd,
          cancel_at_period_end: cancelAtPeriodEnd,
          updated_at: new Date().toISOString(),
        } as any,
        { onConflict: 'user_id' }
      );
    }

    return NextResponse.json({ received: true }, { status: 200 });
  }

  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const sub = event.data.object as Stripe.Subscription;
    const meta = (sub as any).metadata ?? {};
    const planId = getStringMeta(meta, 'planId');
    const userId = getStringMeta(meta, 'userId');
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;

    const patch: any = {
      plan_id: planId,
      status: String((sub as any).status ?? 'inactive'),
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      current_period_end: isoFromUnixSeconds((sub as any).current_period_end),
      cancel_at_period_end: Boolean((sub as any).cancel_at_period_end),
      updated_at: new Date().toISOString(),
    };

    // Prefer linking by userId (metadata), else fall back to stripe_subscription_id/customer.
    if (userId) {
      await supabaseAdmin.from('subscriptions').upsert({ user_id: userId, ...patch } as any, { onConflict: 'user_id' });
      return NextResponse.json({ received: true }, { status: 200 });
    }

    if (sub.id) {
      const upd = await supabaseAdmin.from('subscriptions').update(patch).eq('stripe_subscription_id', sub.id);
      if (!upd.error) return NextResponse.json({ received: true }, { status: 200 });
    }

    if (customerId) {
      await supabaseAdmin.from('subscriptions').update(patch).eq('stripe_customer_id', customerId);
      return NextResponse.json({ received: true }, { status: 200 });
    }

    return NextResponse.json({ received: true }, { status: 200 });
  }

  // Ignore other event types (but acknowledge).
  return NextResponse.json({ received: true }, { status: 200 });
}


