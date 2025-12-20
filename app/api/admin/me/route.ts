import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null;
    if (!token) {
      return NextResponse.json({ isAdmin: false }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: tokenUserRes, error: tokenUserErr } =
      await supabaseAdmin.auth.getUser(token);
    const user = tokenUserRes?.user ?? null;
    if (tokenUserErr || !user?.id) {
      return NextResponse.json({ isAdmin: false }, { status: 401 });
    }

    const { data: adminRow, error } = await supabaseAdmin
      .from('admin_users')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: error.message ?? String(error) },
        { status: 500 }
      );
    }

    return NextResponse.json({
      isAdmin: String(adminRow?.user_id ?? '') === user.id,
    });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('ADMIN_ME_ERROR', e);
    return NextResponse.json(
      { error: String(e?.message ?? 'Unexpected error') },
      { status: 500 }
    );
  }
}


