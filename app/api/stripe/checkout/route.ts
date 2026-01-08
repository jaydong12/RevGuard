import { NextResponse } from 'next/server';
import type { PlanId } from '../../../../lib/plans';
import { getSupabaseAdmin } from '../../../../lib/server/supabaseAdmin';
import { getStripeServer, getSiteUrlFromRequest } from '../../../../lib/server/stripeServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizePlanId(raw: any): Exclude<PlanId, 'none'> | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'starter' || s === 'growth' || s === 'pro') return s;
  return null;
}

export async function POST(request: Request) {
  try {
    const stripe = getStripeServer();
    const siteUrl = getSiteUrlFromRequest(request);

    const body = (await request.json().catch(() => null)) as any;
    const planId = normalizePlanId(body?.planId);
    if (!planId) {
      return NextResponse.json({ error: 'Missing planId (starter/growth/pro).' }, { status: 400 });
    }

    const authHeader = request.headers.get('authorization') ?? '';
    const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return NextResponse.json({ error: 'Not authenticated. Please log in again.' }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(token);
    const user = userRes?.user ?? null;
    if (userErr || !user?.id) {
      return NextResponse.json({ error: 'Not authenticated. Please log in again.' }, { status: 401 });
    }

    const { data: planRow, error: planErr } = await supabaseAdmin
      .from('subscription_plans')
      .select('id,stripe_price_id,stripe_coupon_id')
      .eq('id', planId)
      .maybeSingle();

    if (planErr || !planRow?.stripe_price_id) {
      return NextResponse.json({ error: 'Plan not found. Please contact support.' }, { status: 400 });
    }

    // Create/retrieve Stripe customer for this user.
    const { data: subRow } = await supabaseAdmin
      .from('subscriptions')
      .select('user_id,stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    let stripeCustomerId = (subRow as any)?.stripe_customer_id ? String((subRow as any).stripe_customer_id) : null;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: String(user.id) },
      });
      stripeCustomerId = customer.id;

      const { error: upErr } = await supabaseAdmin
        .from('subscriptions')
        .upsert(
          {
            user_id: user.id,
            stripe_customer_id: stripeCustomerId,
            plan_id: planId,
            status: 'incomplete',
          } as any,
          { onConflict: 'user_id' }
        );
      if (upErr) {
        return NextResponse.json({ error: 'Failed to save Stripe customer.' }, { status: 500 });
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [{ price: String((planRow as any).stripe_price_id), quantity: 1 }],
      ...(planRow.stripe_coupon_id ? { discounts: [{ coupon: String(planRow.stripe_coupon_id) }] } : {}),
      success_url: `${siteUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/billing/cancel`,
      allow_promotion_codes: !planRow.stripe_coupon_id,
      metadata: { planId, userId: String(user.id) },
      subscription_data: {
        metadata: { planId, userId: String(user.id) },
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('STRIPE_CHECKOUT_ERROR', e);
    return NextResponse.json(
      { error: e?.message ?? 'Failed to create checkout session.' },
      { status: 500 }
    );
  }
}


