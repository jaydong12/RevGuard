import Stripe from 'stripe';
import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    const priceId = process.env.STRIPE_PRICE_ID;
    const couponId = process.env.STRIPE_COUPON_ID;

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_URL ||
      'http://localhost:3000';

    if (!secretKey) {
      return NextResponse.json(
        {
          error:
            'Missing STRIPE_SECRET_KEY. Add it to your .env.local and restart the dev server.',
        },
        { status: 500 }
      );
    }
    if (!priceId) {
      return NextResponse.json(
        {
          error:
            'Missing STRIPE_PRICE_ID. Create a $99/mo recurring Price in Stripe and set STRIPE_PRICE_ID.',
        },
        { status: 500 }
      );
    }
    if (priceId.startsWith('prod_')) {
      return NextResponse.json(
        {
          error:
            'Invalid STRIPE_PRICE_ID: you set a Product ID (prod_...). Stripe Checkout needs a Price ID (price_...). Create a recurring Price ($99/mo) and copy its Price ID.',
        },
        { status: 500 }
      );
    }
    if (!priceId.startsWith('price_')) {
      return NextResponse.json(
        {
          error:
            'Invalid STRIPE_PRICE_ID: expected a Price ID like price_..., but got something else. Copy the Price ID from Stripe (not the Product ID).',
        },
        { status: 500 }
      );
    }

    const stripe = new Stripe(secretKey);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
      success_url: `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/pricing`,
      // If you don't provide STRIPE_COUPON_ID, allow users to enter a promo code.
      allow_promotion_codes: !couponId,
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


