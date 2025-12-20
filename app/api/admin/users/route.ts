import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: tokenUserRes, error: tokenUserErr } =
      await supabaseAdmin.auth.getUser(token);
    const user = tokenUserRes?.user ?? null;
    if (tokenUserErr || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Admin-only
    const { data: adminRow, error: adminErr } = await supabaseAdmin
      .from('admin_users')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (adminErr) {
      return NextResponse.json(
        { error: adminErr.message ?? String(adminErr) },
        { status: 500 }
      );
    }
    if (!adminRow?.user_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // List users (auth.users) via admin API (service role).
    // Use `any` to be resilient to minor supabase-js typing/version differences.
    const listUsers = (supabaseAdmin.auth.admin as any).listUsers?.bind(
      supabaseAdmin.auth.admin
    );
    if (!listUsers) {
      return NextResponse.json(
        { error: 'Supabase admin listUsers is not available in this SDK version.' },
        { status: 500 }
      );
    }

    const res = await listUsers({ page: 1, perPage: 200 });
    if (res.error) {
      return NextResponse.json(
        { error: res.error.message ?? String(res.error) },
        { status: 500 }
      );
    }

    const users = (res.data?.users ?? []).map((u: any) => ({
      id: String(u.id),
      email: u.email ?? null,
      created_at: u.created_at ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null,
    }));

    return NextResponse.json({ users });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('ADMIN_USERS_LIST_ERROR', e);
    return NextResponse.json(
      { error: String(e?.message ?? 'Unexpected error') },
      { status: 500 }
    );
  }
}


