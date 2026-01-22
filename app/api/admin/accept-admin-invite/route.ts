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
    const businessId = String(body?.businessId ?? '').trim();
    if (!businessId || !isUuid(businessId)) {
      return NextResponse.json({ error: 'Missing/invalid businessId.' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const { data: tokenUserRes, error: tokenUserErr } = await admin.auth.getUser(token);
    const user = tokenUserRes?.user ?? null;
    if (tokenUserErr || !user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const email = String(user.email ?? '').trim().toLowerCase();
    if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Validate invite exists and is still open.
    const { data: inv, error: invErr } = await admin
      .from('admin_invites')
      .select('id,business_id,email,accepted_at')
      .eq('business_id', businessId)
      .eq('email', email)
      .is('accepted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (invErr) {
      return NextResponse.json({ error: invErr.message ?? 'Could not validate invite.' }, { status: 500 });
    }
    if (!inv?.id) {
      return NextResponse.json({ error: 'No admin invite found for this email.' }, { status: 403 });
    }

    // Upsert admin membership for this business.
    const { error: bmErr } = await admin
      .from('business_members')
      .upsert(
        { business_id: businessId, user_id: user.id, role: 'admin' } as any,
        { onConflict: 'business_id,user_id' }
      );
    if (bmErr) {
      return NextResponse.json({ error: bmErr.message ?? 'Failed to create membership.' }, { status: 500 });
    }

    // Keep profile business_id in sync and mark as manager-level (non-employee).
    const { error: pErr } = await admin
      .from('profiles')
      .upsert({ id: user.id, business_id: businessId, role: 'manager' } as any, { onConflict: 'id' });
    if (pErr) {
      return NextResponse.json({ error: pErr.message ?? 'Failed to update profile.' }, { status: 500 });
    }

    // Mark invite accepted.
    const { error: accErr } = await admin
      .from('admin_invites')
      .update({ accepted_at: new Date().toISOString(), accepted_user_id: user.id } as any)
      .eq('id', Number((inv as any).id));
    if (accErr) {
      return NextResponse.json({ error: accErr.message ?? 'Failed to mark invite accepted.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('ACCEPT_ADMIN_INVITE_ERROR', e);
    return NextResponse.json({ error: String(e?.message ?? 'Unexpected error') }, { status: 500 });
  }
}


