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
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as any;
    const email = String(body?.email ?? '').trim().toLowerCase();
    const businessId = String(body?.businessId ?? '').trim();
    const workerIdRaw = body?.workerId;
    const workerId = Number(workerIdRaw);

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required.' }, { status: 400 });
    }
    if (!businessId || !isUuid(businessId)) {
      return NextResponse.json({ error: 'Missing/invalid businessId.' }, { status: 400 });
    }
    if (!Number.isFinite(workerId) || workerId <= 0) {
      return NextResponse.json({ error: 'Missing/invalid workerId.' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    // Validate token + get actor user id
    const { data: tokenUserRes, error: tokenUserErr } = await admin.auth.getUser(token);
    const actor = tokenUserRes?.user ?? null;
    if (tokenUserErr || !actor?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Confirm actor owns this business
    const { data: biz, error: bizErr } = await admin
      .from('business')
      .select('id, owner_id')
      .eq('id', businessId)
      .maybeSingle();
    if (bizErr || !biz?.id) {
      return NextResponse.json({ error: 'Business not found.' }, { status: 404 });
    }
    if (String((biz as any).owner_id ?? '') !== actor.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Confirm worker belongs to business
    const { data: w, error: wErr } = await admin
      .from('workers')
      .select('id, business_id, name')
      .eq('id', workerId)
      .eq('business_id', businessId)
      .maybeSingle();
    if (wErr || !w?.id) {
      return NextResponse.json({ error: 'Worker not found for this business.' }, { status: 404 });
    }

    // Invite user
    const inviteRes = await admin.auth.admin.inviteUserByEmail(email);
    const invitedUser = inviteRes.data?.user ?? null;
    if (inviteRes.error || !invitedUser?.id) {
      return NextResponse.json(
        { error: inviteRes.error?.message ?? 'Failed to invite user.' },
        { status: 400 }
      );
    }

    // Store the email on the worker row (for first-login linking on employee device).
    // Do NOT pre-link workers.user_id here; it will be linked on the employee's first login
    // only if the auth email matches and the worker is unlinked.
    const { error: wLinkErr } = await admin
      .from('workers')
      .update({ email, role: 'employee' } as any)
      .eq('id', workerId)
      .eq('business_id', businessId);
    if (wLinkErr) {
      return NextResponse.json(
        { error: wLinkErr.message ?? 'Invite created, but failed to update worker.' },
        { status: 500 }
      );
    }

    // Optional: also create a membership row (uses real UUIDs; no placeholders).
    // This will be used by future member-based access and helps debug RLS issues.
    const { error: mErr } = await admin
      .from('business_members')
      .upsert(
        {
          business_id: businessId,
          user_id: invitedUser.id,
          role: 'employee',
          worker_id: workerId,
        } as any,
        { onConflict: 'business_id,user_id' }
      );
    if (mErr) {
      return NextResponse.json(
        {
          error:
            mErr.message ??
            'Invite created, but failed to add employee to business_members. Run supabase/business_members.sql.',
        },
        { status: 500 }
      );
    }

    // Backward-compatible: keep profiles in sync for older UI paths.
    const { error: pErr } = await admin.from('profiles').upsert(
      {
        id: invitedUser.id,
        business_id: businessId,
        role: 'employee',
        worker_id: workerId,
        full_name: String((w as any)?.name ?? '').trim() || null,
      } as any,
      { onConflict: 'id' }
    );
    if (pErr) {
      return NextResponse.json(
        { error: pErr.message ?? 'Invite created, but failed to link profile.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      invited_user_id: invitedUser.id,
      email,
      worker_id: workerId,
    });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('WORKERS_INVITE_ERROR', e);
    return NextResponse.json(
      { error: String(e?.message ?? 'Unexpected error') },
      { status: 500 }
    );
  }
}


