import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/server/supabaseAdmin';
import { getStripeServer, getSiteUrlFromRequest } from '../../../../lib/server/stripeServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const stripe = getStripeServer();
    const siteUrl = getSiteUrlFromRequest(request);

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

    const { data: sub, error: subErr } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    const customerId = sub?.stripe_customer_id ? String(sub.stripe_customer_id) : null;
    if (subErr || !customerId) {
      return NextResponse.json({ error: 'No billing customer found.' }, { status: 400 });
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${siteUrl}/settings?tab=billing`,
    });

    return NextResponse.json({ url: portal.url });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('STRIPE_PORTAL_ERROR', e);
    return NextResponse.json({ error: e?.message ?? 'Failed to create portal session.' }, { status: 500 });
  }
}


