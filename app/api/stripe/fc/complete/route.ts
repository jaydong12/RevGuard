import { NextResponse } from 'next/server';
import { getStripeServer } from '../../../../../lib/server/stripeServer';
import { getSupabaseAdmin } from '../../../../../lib/server/supabaseAdmin';
import { requireAuthedUser, requireBusinessMember } from '../../../../../lib/server/authz';
import { syncStripeFcBusiness } from '../../../../../lib/server/bank/stripeFc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { user, error: authErr } = await requireAuthedUser();
    if (authErr || !user?.id) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

    const body = (await request.json().catch(() => null)) as any;
    const businessIdRaw = String(body?.business_id ?? body?.businessId ?? '').trim();
    const sessionId = String(body?.session_id ?? body?.sessionId ?? '').trim();
    if (!sessionId) return NextResponse.json({ error: 'Missing session_id.' }, { status: 400 });

    const membership = await requireBusinessMember(businessIdRaw, user.id);
    if (membership.error || !membership.businessId) {
      return NextResponse.json({ error: membership.error ?? 'Forbidden.' }, { status: 403 });
    }
    const businessId = membership.businessId;

    const stripe = getStripeServer();
    const admin = getSupabaseAdmin();

    const session = await stripe.financialConnections.sessions.retrieve(sessionId as any);

    // Linked accounts for this session.
    const accounts = await stripe.financialConnections.accounts.list({ session: sessionId, limit: 100 } as any);
    const acctList = (accounts?.data ?? []) as any[];
    if (acctList.length === 0) {
      return NextResponse.json({ error: 'No financial accounts were linked.' }, { status: 400 });
    }

    // Upsert a connection (provider_item_id=sessionId in Phase 1).
    const connUp = await admin
      .from('bank_connections')
      .upsert(
        {
          business_id: businessId,
          provider: 'stripe_fc',
          provider_item_id: sessionId,
          status: String((session as any)?.status ?? 'active'),
          last_sync_at: null,
          last_cursor: null,
        } as any,
        { onConflict: 'business_id,provider,provider_item_id' }
      )
      .select('id')
      .single();
    if (connUp.error) {
      return NextResponse.json({ error: connUp.error.message ?? 'Failed to save bank connection.' }, { status: 500 });
    }
    const bankConnectionId = String((connUp.data as any).id);

    // Upsert accounts.
    const accountRows = acctList.map((a) => ({
      business_id: businessId,
      provider: 'stripe_fc',
      provider_account_id: String(a.id),
      bank_connection_id: bankConnectionId,
      name: String(a.display_name ?? a.name ?? 'Bank account'),
      mask: a.last4 ? String(a.last4) : null,
      currency: String(a.currency ?? 'usd').toUpperCase(),
      status: 'active',
    }));

    const acctUp = await admin
      .from('bank_accounts')
      .upsert(accountRows as any, { onConflict: 'business_id,provider,provider_account_id' });
    if (acctUp.error) {
      return NextResponse.json({ error: acctUp.error.message ?? 'Failed to save bank accounts.' }, { status: 500 });
    }

    // Trigger initial sync (server-only).
    // TODO(Phase2): move to async job/queue + cron/webhooks.
    const syncRes = await syncStripeFcBusiness({ businessId, triggeredByUserId: user.id });

    return NextResponse.json({
      ok: true,
      session_status: String((session as any)?.status ?? ''),
      accounts: acctList.map((a) => ({ id: String(a.id), name: String(a.display_name ?? a.name ?? '') })),
      sync: syncRes,
    });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('STRIPE_FC_COMPLETE_ERROR', e);
    return NextResponse.json({ error: e?.message ?? 'Failed to complete bank connection.' }, { status: 500 });
  }
}


