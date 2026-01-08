// Backwards-compatible route alias (legacy clients may call this path).
// Prefer POST /api/stripe/checkout with { planId }.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export { POST } from '../checkout/route';


