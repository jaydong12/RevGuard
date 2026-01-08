import Stripe from 'stripe';

export function getStripeServer() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('Missing STRIPE_SECRET_KEY');
  }
  return new Stripe(secretKey);
}

export function getSiteUrlFromRequest(request: Request) {
  const origin = request.headers.get('origin') ?? new URL(request.url).origin;
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    origin;
  return raw.replace(/\/+$/, '');
}


