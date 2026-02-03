import { createSupabaseServerClient } from './supabaseServer';
import { getSupabaseAdmin } from './supabaseAdmin';

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export async function requireAuthedUser() {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.auth.getUser();
  const user = data?.user ?? null;
  if (error || !user?.id) {
    return { user: null, error: 'Not authenticated.' };
  }
  return { user, error: null };
}

export async function requireBusinessMember(businessIdRaw: string, userId: string) {
  const businessId = String(businessIdRaw ?? '').trim();
  if (!isUuid(businessId)) return { businessId: null, error: 'Invalid business_id.' as const };

  const admin = getSupabaseAdmin();
  const { data: bm } = await admin
    .from('business_members')
    .select('business_id,role')
    .eq('business_id', businessId)
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  if ((bm as any)?.business_id) return { businessId, role: String((bm as any).role ?? ''), error: null };

  // Owners may not have a business_members row.
  const { data: biz } = await admin.from('business').select('id,owner_id').eq('id', businessId).maybeSingle();
  if (String((biz as any)?.owner_id ?? '') === userId) return { businessId, role: 'owner', error: null };

  return { businessId: null, error: 'Forbidden.' as const };
}

export function requireBusinessWriteRole(role: string | null | undefined) {
  const r = String(role ?? '').toLowerCase();
  const ok = r === 'owner' || r === 'manager' || r === 'admin';
  return ok ? { ok: true as const } : { ok: false as const, error: 'Forbidden.' as const };
}


