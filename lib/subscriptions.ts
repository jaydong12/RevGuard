import type { PlanId } from './plans';
import { getSupabaseAdmin } from './server/supabaseAdmin';

export type ActiveSubscriptionResult = {
  active: boolean;
  plan: PlanId;
  status: string;
  current_period_end: string | null;
};

function normalizePlanId(raw: any): PlanId {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'starter') return 'starter';
  if (s === 'growth') return 'growth';
  if (s === 'pro') return 'pro';
  return 'none';
}

function isActiveByStatusAndPeriod(params: { status: string; currentPeriodEnd: string | null }) {
  const st = String(params.status ?? '').trim().toLowerCase();
  const okStatus = st === 'active' || st === 'trialing';
  if (!okStatus) return false;
  if (!params.currentPeriodEnd) return true;
  const d = new Date(params.currentPeriodEnd);
  if (Number.isNaN(d.getTime())) return okStatus;
  return d.getTime() > Date.now();
}

export async function getActiveSubscription(userId: string): Promise<ActiveSubscriptionResult> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('subscriptions')
    .select('user_id, plan_id, status, current_period_end')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data?.user_id) {
    return { active: false, plan: 'none', status: 'inactive', current_period_end: null };
  }

  const status = String((data as any).status ?? 'inactive');
  const currentPeriodEnd = ((data as any).current_period_end as string | null) ?? null;
  const active = isActiveByStatusAndPeriod({ status, currentPeriodEnd });
  const plan = active ? normalizePlanId((data as any).plan_id) : 'none';
  return { active, plan, status, current_period_end: currentPeriodEnd };
}


