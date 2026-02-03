import { NextResponse } from 'next/server';
import { requireAuthedUser, requireBusinessMember, requireBusinessWriteRole } from '../../../../../lib/server/authz';
import { syncStripeFcBusiness } from '../../../../../lib/server/bank/stripeFc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Safe member-triggered sync. Still runs server-side only (service role).
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
    const roleCheck = requireBusinessWriteRole((membership as any).role);
    if (!roleCheck.ok) return NextResponse.json({ error: roleCheck.error }, { status: 403 });

    const res = await syncStripeFcBusiness({ businessId: membership.businessId, triggeredByUserId: user.id });
    return NextResponse.json(res);
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('STRIPE_FC_SYNC_NOW_ERROR', e);
    return NextResponse.json({ error: e?.message ?? 'Sync failed.' }, { status: 500 });
  }
}


