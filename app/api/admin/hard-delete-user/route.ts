import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { hardDeleteUserServer } from '../../../../lib/hardDeleteUser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

function shouldIgnoreMissingTableOrColumn(err: any): boolean {
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  // PostgREST "schema cache" errors for missing tables/columns.
  if (msg.includes('schema cache')) return true;
  if (msg.includes('could not find the table')) return true;
  if (msg.includes('does not exist')) return true;
  if (msg.includes('unknown column')) return true;
  if (msg.includes('column') && msg.includes('does not exist')) return true;
  return false;
}

export async function POST(request: Request) {
  try {
    // Require Authorization: Bearer <access_token>
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as { user_id?: string; confirm?: string };
    const userId = String(body.user_id ?? '').trim();
    const confirm = String(body.confirm ?? '').trim();
    if (confirm !== 'DELETE') {
      return NextResponse.json(
        { error: 'Safety check failed. Include { confirm: "DELETE" }.' },
        { status: 400 }
      );
    }
    if (!userId || !isUuid(userId)) {
      return NextResponse.json(
        { error: 'Missing/invalid user_id (uuid required).' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Verify the token is valid and belongs to a user.
    const { data: tokenUserRes, error: tokenUserErr } =
      await supabaseAdmin.auth.getUser(token);
    const tokenUser = tokenUserRes?.user ?? null;
    if (tokenUserErr || !tokenUser?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Allow only admins (presence in public.admin_users).
    const { data: adminRow, error: adminErr } = await supabaseAdmin
      .from('admin_users')
      .select('user_id')
      .eq('user_id', tokenUser.id)
      .maybeSingle();

    if (adminErr && !shouldIgnoreMissingTableOrColumn(adminErr)) {
      return NextResponse.json(
        { error: `Failed checking admin status: ${adminErr.message ?? adminErr}` },
        { status: 500 }
      );
    }

    if (!adminRow?.user_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const res = await hardDeleteUserServer({
      actorUserId: tokenUser.id,
      action: 'HARD_DELETE_USER',
      targetUserId: userId,
    });

    return NextResponse.json(res);
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('HARD_DELETE_USER_ERROR', e);
    return NextResponse.json(
      { error: String(e?.message ?? 'Unexpected error') },
      { status: 500 }
    );
  }
}


