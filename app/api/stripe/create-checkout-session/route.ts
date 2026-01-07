import Stripe from 'stripe';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeSiteUrl(raw: string) {
  return raw.replace(/\/+$/, '');
}

export async function POST(request: Request) {
  try {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    const priceId = process.env.STRIPE_PRICE_ID;
    const couponId = process.env.STRIPE_COUPON_ID;

    const origin = request.headers.get('origin') ?? new URL(request.url).origin;
    const appUrl = normalizeSiteUrl(
      process.env.NEXT_PUBLIC_SITE_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.APP_URL ||
        origin
    );

    if (!secretKey) {
      return NextResponse.json(
        { error: 'Missing STRIPE_SECRET_KEY' },
        { status: 500 }
      );
    }
    if (!priceId) {
      return NextResponse.json(
        { error: 'Missing STRIPE_PRICE_ID' },
        { status: 500 }
      );
    }
    if (priceId.startsWith('prod_')) {
      return NextResponse.json(
        {
          error:
            'Invalid STRIPE_PRICE_ID: you set a Product ID (prod_...). Stripe Checkout needs a Price ID (price_...).',
        },
        { status: 500 }
      );
    }
    if (!priceId.startsWith('price_')) {
      return NextResponse.json(
        {
          error:
            'Invalid STRIPE_PRICE_ID: expected a Price ID like price_..., but got something else.',
        },
        { status: 500 }
      );
    }

    const stripe = new Stripe(secretKey);

    // Require authenticated Supabase user.
    const authHeader = request.headers.get('authorization') ?? '';
    const token = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return NextResponse.json(
        { error: 'Not authenticated. Please log in again.' },
        { status: 401 }
      );
    }

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
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      }
    );

    const { data: userRes, error: userErr } = await supabase.auth.getUser(token);
    const user = userRes?.user ?? null;
    if (userErr || !user) {
      return NextResponse.json(
        { error: 'Not authenticated. Please log in again.' },
        { status: 401 }
      );
    }

    const { data: biz, error: bizErr } = await supabase
      .from('business')
      .select('id, name, owner_id, stripe_customer_id')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (bizErr || !biz?.id) {
      return NextResponse.json(
        { error: 'Could not load your business. Please refresh and try again.' },
        { status: 400 }
      );
    }

    let stripeCustomerId = (biz as any).stripe_customer_id as string | null;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        name: (biz as any).name ?? undefined,
        metadata: {
          business_id: String(biz.id),
          owner_id: String(user.id),
        },
      });

      stripeCustomerId = customer.id;

      const { error: updErr } = await supabase
        .from('business')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', biz.id)
        .eq('owner_id', user.id);

      if (updErr) {
        return NextResponse.json(
          {
            error:
              'Failed to save billing customer. Run `supabase/business_stripe_fields.sql` then try again.',
          },
          { status: 500 }
        );
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
      success_url: `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/pricing`,
      allow_promotion_codes: !couponId,
      customer: stripeCustomerId,
      client_reference_id: String(biz.id),
      metadata: { business_id: String(biz.id), owner_id: String(user.id) },
      subscription_data: {
        metadata: { business_id: String(biz.id), owner_id: String(user.id) },
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


