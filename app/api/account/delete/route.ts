import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    // Require Authorization: Bearer <access_token>
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as { confirm?: string };
    const confirm = String(body.confirm ?? '').trim();
    if (confirm !== 'DELETE') {
      return NextResponse.json(
        { error: 'Safety check failed. Include { confirm: "DELETE" }.' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: tokenUserRes, error: tokenUserErr } =
      await supabaseAdmin.auth.getUser(token);
    const user = tokenUserRes?.user ?? null;
    if (tokenUserErr || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // No user_id param allowed — can only delete yourself.
    // Data deletion relies on DB cascade constraints (see SQL migration).
    const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (delErr) {
      return NextResponse.json(
        { error: delErr.message ?? 'Delete failed.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('SELF_DELETE_ERROR', e);
    return NextResponse.json(
      { error: String(e?.message ?? 'Unexpected error') },
      { status: 500 }
    );
  }
}


