import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_EMAILS = ['jaydongant@gmail.com', 'shannon_g75@yahoo.com'].map((e) =>
  e.toLowerCase()
);

export type SubscriptionGateResult =
  | { ok: true; userId: string; status: 'active' }
  | NextResponse;

function getBearerToken(request: Request): string | null {
  const auth = request.headers.get('authorization') ?? '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7);
  return null;
}

export async function requireActiveSubscription(request: Request): Promise<SubscriptionGateResult> {
  const token = getBearerToken(request);
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );

  const { data: userRes, error: userErr } = await supabase.auth.getUser(token);
  const user = userRes?.user ?? null;
  if (userErr || !user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const email = String(user.email ?? '').trim().toLowerCase();
  if (email && ADMIN_EMAILS.includes(email)) {
    return { ok: true, userId: user.id, status: 'active' };
  }

  const { data: biz, error: bizErr } = await supabase
    .from('business')
    .select('id, subscription_status')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (bizErr || !biz?.id) {
    return NextResponse.json({ error: 'Subscription inactive' }, { status: 403 });
  }

  const status = String((biz as any)?.subscription_status ?? 'inactive').toLowerCase();
  if (status !== 'active') {
    return NextResponse.json({ error: 'Subscription inactive' }, { status: 403 });
  }

  return { ok: true, userId: user.id, status: 'active' };
}


