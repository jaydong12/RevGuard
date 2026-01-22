import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/server/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export async function POST(request: Request) {
  try {
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json().catch(() => null)) as any;
    const email = String(body?.email ?? '').trim().toLowerCase();
    const businessId = String(body?.businessId ?? '').trim();
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required.' }, { status: 400 });
    }
    if (!businessId || !isUuid(businessId)) {
      return NextResponse.json({ error: 'Missing/invalid businessId.' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const { data: tokenUserRes, error: tokenUserErr } = await admin.auth.getUser(token);
    const actor = tokenUserRes?.user ?? null;
    if (tokenUserErr || !actor?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Owner-only for now (keeps this "admin onboarding" flow tightly controlled).
    const { data: biz, error: bizErr } = await admin
      .from('business')
      .select('id, owner_id')
      .eq('id', businessId)
      .maybeSingle();
    if (bizErr || !biz?.id) return NextResponse.json({ error: 'Business not found.' }, { status: 404 });
    if (String((biz as any).owner_id ?? '') !== actor.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const siteUrl =
      (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '') || new URL(request.url).origin;

    // Record invite for later verification on callback.
    const { error: invErr } = await admin.from('admin_invites').insert({
      business_id: businessId,
      email,
      created_by: actor.id,
    } as any);
    if (invErr) {
      return NextResponse.json({ error: invErr.message ?? 'Failed to create invite record.' }, { status: 500 });
    }

    const inviteRes = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${siteUrl}/auth/callback?next=/onboarding&admin_invite=1&business_id=${encodeURIComponent(
        businessId
      )}`,
    });
    const invitedUser = inviteRes.data?.user ?? null;
    if (inviteRes.error || !invitedUser?.id) {
      return NextResponse.json(
        { error: inviteRes.error?.message ?? 'Failed to invite user.' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      invited_user_id: invitedUser.id,
      email,
      business_id: businessId,
    });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('ADMIN_INVITE_ERROR', e);
    return NextResponse.json({ error: String(e?.message ?? 'Unexpected error') }, { status: 500 });
  }
}


