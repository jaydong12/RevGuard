import { NextResponse } from 'next/server';
import { getStripeServer } from '../../../../../lib/server/stripeServer';
import { getSupabaseAdmin } from '../../../../../lib/server/supabaseAdmin';
import { requireAuthedUser, requireBusinessMember } from '../../../../../lib/server/authz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { user, error: authErr } = await requireAuthedUser();
    if (authErr || !user?.id) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

    const body = (await request.json().catch(() => null)) as any;
    const businessIdRaw = String(body?.business_id ?? body?.businessId ?? '').trim();

    const membership = await requireBusinessMember(businessIdRaw, user.id);
    if (membership.error || !membership.businessId) {
      return NextResponse.json({ error: membership.error ?? 'Forbidden.' }, { status: 403 });
    }
    const businessId = membership.businessId;

    const admin = getSupabaseAdmin();

    // Ensure Stripe customer exists for business (preferred) or fall back to subscriptions table.
    const { data: bizRow, error: bizErr } = await admin
      .from('business')
      .select('id,stripe_customer_id,name')
      .eq('id', businessId)
      .maybeSingle();
    if (bizErr) return NextResponse.json({ error: 'Failed to load business.' }, { status: 500 });

    const stripe = getStripeServer();
    let stripeCustomerId = (bizRow as any)?.stripe_customer_id ? String((bizRow as any).stripe_customer_id) : null;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { business_id: String(businessId), created_by: String(user.id) },
        name: (bizRow as any)?.name ? String((bizRow as any).name) : undefined,
      });
      stripeCustomerId = customer.id;
      await admin.from('business').update({ stripe_customer_id: stripeCustomerId } as any).eq('id', businessId);
    }

    // Create Financial Connections Session (Stripe handles bank credentials; we store only ids).
    // TODO(Phase2): consider webhook verification + finer-grained permissions.
    const session = await stripe.financialConnections.sessions.create({
      account_holder: { type: 'customer', customer: stripeCustomerId },
      permissions: ['transactions'],
    } as any);

    return NextResponse.json({
      session_id: session.id,
      client_secret: session.client_secret,
    });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('STRIPE_FC_SESSION_ERROR', e);
    return NextResponse.json({ error: e?.message ?? 'Failed to create bank connection session.' }, { status: 500 });
  }
}


