import { cookies, headers } from 'next/headers';
import { getSupabaseAdmin } from '../../../lib/server/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function getRequestToken(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7);
  const cookieStore = await cookies();
  const cookieToken = cookieStore.get('rg_at')?.value ?? null;
  return cookieToken || null;
}

export async function requireEmployee(req: Request): Promise<{
  admin: ReturnType<typeof getSupabaseAdmin>;
  userId: string;
  email: string;
}> {
  const token = await getRequestToken(req);
  if (!token) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: u, error: uErr } = await admin.auth.getUser(token);
  const user = u?.user ?? null;
  if (uErr || !user?.id) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  const { data: prof, error: pErr } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .limit(1)
    .maybeSingle();
  const role = String((prof as any)?.role ?? '').toLowerCase();
  if (pErr || role !== 'employee') throw Object.assign(new Error('Forbidden'), { status: 403 });

  const email = String(user.email ?? '').trim().toLowerCase();
  if (!email) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  return { admin, userId: user.id, email };
}

export async function getEmployeeWorker(admin: ReturnType<typeof getSupabaseAdmin>, userId: string) {
  const { data, error } = await admin
    .from('workers')
    .select('id,business_id,user_id,email,is_active,name')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as any) ?? null;
}

export async function tryLinkWorkerOnFirstLogin(params: {
  admin: ReturnType<typeof getSupabaseAdmin>;
  userId: string;
  email: string;
}) {
  const { admin, userId, email } = params;

  // Find an unlinked worker invite matching this email.
  const { data: w, error: wErr } = await admin
    .from('workers')
    .select('id,business_id,user_id,email')
    .eq('email', email)
    .is('user_id', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (wErr) throw wErr;
  const worker = (w as any) ?? null;
  if (!worker?.id || !worker?.business_id) return { linked: false as const, reason: 'no_match' as const };

  // Ensure this user is actually a business member employee for that business.
  const { data: bm, error: bmErr } = await admin
    .from('business_members')
    .select('business_id,role')
    .eq('business_id', String(worker.business_id))
    .eq('user_id', userId)
    .eq('role', 'employee')
    .limit(1)
    .maybeSingle();
  if (bmErr || !(bm as any)?.business_id) {
    return { linked: false as const, reason: 'not_a_member' as const };
  }

  const { error: upErr } = await admin
    .from('workers')
    .update({ user_id: userId } as any)
    .eq('id', Number(worker.id))
    .eq('business_id', String(worker.business_id))
    .is('user_id', null);
  if (upErr) throw upErr;

  return { linked: true as const };
}

export async function getClientMeta() {
  const h = await headers();
  const ipRaw = h.get('x-forwarded-for') || h.get('x-real-ip') || '';
  const ip = ipRaw.split(',')[0]?.trim() || null;
  const userAgent = h.get('user-agent') || null;
  return { ip, userAgent };
}


