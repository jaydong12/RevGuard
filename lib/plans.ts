export type PlanId = 'none' | 'starter' | 'growth' | 'pro';

export type FeatureKey =
  | 'dashboard'
  | 'transactions'
  | 'invoices'
  | 'customers'
  | 'reports_basic'
  | 'reports_full'
  | 'settings'
  | 'bookings'
  | 'workers'
  | 'bills'
  | 'notifications'
  | 'ai_advisor';

export const PLAN_ORDER: PlanId[] = ['none', 'starter', 'growth', 'pro'];

export function comparePlans(a: PlanId, b: PlanId): number {
  return PLAN_ORDER.indexOf(a) - PLAN_ORDER.indexOf(b);
}

export function atLeast(current: PlanId, required: PlanId): boolean {
  return comparePlans(current, required) >= 0;
}

export const PLAN_META: Record<
  Exclude<PlanId, 'none'>,
  {
    id: Exclude<PlanId, 'none'>;
    label: string;
    priceMonthly: number; // USD
    promoFirstMonth: number; // USD
  }
> = {
  starter: { id: 'starter', label: 'Starter', priceMonthly: 30, promoFirstMonth: 10 },
  growth: { id: 'growth', label: 'Growth', priceMonthly: 69, promoFirstMonth: 40 },
  pro: { id: 'pro', label: 'Pro', priceMonthly: 99, promoFirstMonth: 69 },
};

export const PLAN_FEATURES: Record<Exclude<PlanId, 'none'>, FeatureKey[]> = {
  starter: [
    'dashboard',
    'transactions',
    'invoices',
    'customers',
    'reports_basic',
    'settings',
  ],
  growth: [
    'dashboard',
    'transactions',
    'invoices',
    'customers',
    'reports_full',
    'settings',
    'bookings',
    'workers',
    'bills',
    'notifications',
  ],
  pro: [
    'dashboard',
    'transactions',
    'invoices',
    'customers',
    'reports_full',
    'settings',
    'bookings',
    'workers',
    'bills',
    'notifications',
    'ai_advisor',
  ],
};

export const FEATURE_MIN_PLAN: Record<FeatureKey, PlanId> = {
  dashboard: 'starter',
  transactions: 'starter',
  invoices: 'starter',
  customers: 'starter',
  reports_basic: 'starter',
  reports_full: 'growth',
  settings: 'starter',
  bookings: 'growth',
  workers: 'growth',
  bills: 'growth',
  notifications: 'growth',
  ai_advisor: 'pro',
};

export function requiredPlanForFeature(feature: FeatureKey): PlanId {
  return FEATURE_MIN_PLAN[feature] ?? 'pro';
}

export function featuresForPlan(plan: PlanId): FeatureKey[] {
  if (plan === 'none') return [];
  return PLAN_FEATURES[plan] ?? [];
}

export function hasFeature(plan: PlanId, feature: FeatureKey): boolean {
  if (plan === 'none') return false;
  // Full reports implies basic reports.
  if (feature === 'reports_basic') return atLeast(plan, 'starter');
  if (feature === 'reports_full') return atLeast(plan, 'growth');
  return atLeast(plan, requiredPlanForFeature(feature));
}

export function requiredPlanForPath(pathname: string): PlanId | null {
  // Note: keep this list small and explicit. Anything not listed here is treated as ungated.
  const p = pathname;
  if (p === '/dashboard' || p.startsWith('/dashboard/')) return 'starter';
  if (p === '/transactions') return 'starter';
  if (p === '/invoices') return 'starter';
  if (p === '/customers') return 'starter';
  if (p === '/reports' || p.startsWith('/reports/')) return 'starter';
  if (p === '/settings' || p.startsWith('/settings/')) return 'starter';

  if (p === '/dashboard/bookings' || p.startsWith('/dashboard/bookings/')) return 'growth';
  if (p === '/workers' || p.startsWith('/workers/')) return 'growth';
  if (p === '/bills' || p.startsWith('/bills/')) return 'growth';
  if (p === '/notifications' || p.startsWith('/notifications/')) return 'growth';

  if (p === '/ai-advisor' || p.startsWith('/ai-advisor/')) return 'pro';

  return null;
}


