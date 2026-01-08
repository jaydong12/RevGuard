import { NextResponse, type NextRequest } from 'next/server';
import { atLeast, requiredPlanForPath, type PlanId } from './lib/plans';

const ADMIN_EMAILS = ['jaydongant@gmail.com', 'shannon_g75@yahoo.com'].map((e) =>
  e.toLowerCase()
);

const PUBLIC_PATHS = new Set<string>([
  '/',
  '/login',
  '/signup',
  '/pricing',
  // Required for Stripe return flow (checkout success_url).
  '/billing/success',
  '/billing/cancel',
]);

// These routes should require auth, but should NOT be blocked by subscription status.
const AUTH_ONLY_NO_SUBSCRIPTION = new Set<string>(['/billing/success']);

function isPublicPath(pathname: string) {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith('/auth/')) return true;
  return false;
}

function isAuthOnlyNoSubscriptionPath(pathname: string) {
  return AUTH_ONLY_NO_SUBSCRIPTION.has(pathname);
}

function isPublicApi(pathname: string) {
  // Webhook must be publicly accessible (Stripe calls it).
  if (pathname === '/api/stripe/webhook') return true;
  // Users must be able to start checkout even when inactive.
  if (pathname === '/api/stripe/checkout') return true;
  if (pathname === '/api/stripe/create-checkout-session') return true;
  // Pricing page lists plans from a safe server endpoint.
  if (pathname === '/api/subscription-plans') return true;
  return false;
}

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') ?? '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7);
  const cookieToken = req.cookies.get('rg_at')?.value ?? null;
  return cookieToken || null;
}

function decodeJwtPayload(token: string): any | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function getEmailForToken(token: string, payload: any | null): Promise<string | null> {
  // Fast path: many Supabase JWTs include `email` in the payload.
  const claimed = String(payload?.email ?? '').trim().toLowerCase();
  if (claimed) return claimed;

  // Robust path: ask Supabase Auth for the user (works even if JWT lacks `email` claim).
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return null;

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const user = (await res.json().catch(() => null)) as any;
    const email = String(user?.email ?? '').trim().toLowerCase();
    return email || null;
  } catch {
    return null;
  }
}

async function getSubscriptionForOwner(userId: string): Promise<{ status: string; plan: PlanId }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    null;

  if (!supabaseUrl || !serviceKey) return { status: 'inactive', plan: 'none' };
  const sk = serviceKey as string;

  // New model (preferred): subscriptions table (per-user)
  try {
    const url = new URL(`${supabaseUrl}/rest/v1/subscriptions`);
    url.searchParams.set('select', 'status,plan_id,current_period_end');
    url.searchParams.set('user_id', `eq.${userId}`);
    url.searchParams.set('limit', '1');

    const res = await fetch(url.toString(), {
      headers: {
        apikey: sk,
        Authorization: `Bearer ${sk}`,
        Accept: 'application/json',
      },
      // Edge: avoid caching across users
      cache: 'no-store',
    });

    if (res.ok) {
      const rows = (await res.json().catch(() => [])) as any[];
      const r = rows?.[0] ?? null;
      const statusRaw = String(r?.status ?? 'inactive').trim().toLowerCase();
      const planRaw = String(r?.plan_id ?? '').trim().toLowerCase();
      const cpe = r?.current_period_end ? String(r.current_period_end) : null;

      const okStatus = statusRaw === 'active' || statusRaw === 'trialing';
      const okPeriod = !cpe
        ? true
        : (() => {
            const d = new Date(cpe);
            return Number.isNaN(d.getTime()) ? true : d.getTime() > Date.now();
          })();

      const active = okStatus && okPeriod;
      const plan: PlanId =
        planRaw === 'starter'
          ? 'starter'
          : planRaw === 'growth'
            ? 'growth'
            : planRaw === 'pro'
              ? 'pro'
              : active
                ? 'pro'
                : 'none';

      return { status: active ? 'active' : 'inactive', plan: active ? plan : 'none' };
    }
  } catch {
    // ignore and fall back to legacy
  }

  // Legacy fallback (older schema): business.subscription_status/subscription_plan
  async function fetchWithSelect(select: string): Promise<any[] | null> {
    const url = new URL(`${supabaseUrl}/rest/v1/business`);
    url.searchParams.set('select', select);
    url.searchParams.set('owner_id', `eq.${userId}`);
    url.searchParams.set('order', 'created_at.asc');
    url.searchParams.set('limit', '1');

    const res = await fetch(url.toString(), {
      headers: {
        apikey: sk,
        Authorization: `Bearer ${sk}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!res.ok) return null;
    return (await res.json().catch(() => [])) as any[];
  }

  const rows =
    (await fetchWithSelect('subscription_status,subscription_plan')) ??
    (await fetchWithSelect('subscription_status')) ??
    [];

  const status = String(rows?.[0]?.subscription_status ?? 'inactive').toLowerCase();
  const rawPlan = String(rows?.[0]?.subscription_plan ?? '').trim().toLowerCase();
  const plan: PlanId =
    rawPlan === 'starter'
      ? 'starter'
      : rawPlan === 'growth'
        ? 'growth'
        : rawPlan === 'pro'
          ? 'pro'
          : status === 'active'
            ? 'pro'
            : 'none';

  return { status, plan: status === 'active' ? plan : 'none' };
}

async function getProfileForUser(userId: string): Promise<{
  id: string;
  role: string | null;
  business_id: string | null;
  worker_id: number | null;
} | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    null;
  if (!supabaseUrl || !serviceKey) return null;
  const sk = serviceKey as string;

  const url = new URL(`${supabaseUrl}/rest/v1/profiles`);
  url.searchParams.set('select', 'id,role,business_id,worker_id');
  url.searchParams.set('id', `eq.${userId}`);
  url.searchParams.set('limit', '1');

  const res = await fetch(url.toString(), {
    headers: {
      apikey: sk,
      Authorization: `Bearer ${sk}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const rows = (await res.json().catch(() => [])) as any[];
  const r = rows?.[0] ?? null;
  if (!r?.id) return null;
  return {
    id: String(r.id),
    role: r.role === null || r.role === undefined ? null : String(r.role),
    business_id: r.business_id === null || r.business_id === undefined ? null : String(r.business_id),
    worker_id: r.worker_id === null || r.worker_id === undefined ? null : Number(r.worker_id),
  };
}

async function getSubscriptionForBusinessId(businessId: string): Promise<{ status: string; plan: PlanId }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    null;
  if (!supabaseUrl || !serviceKey) return { status: 'inactive', plan: 'none' };
  const sk = serviceKey as string;

  // Gate by the BUSINESS OWNER's subscription (owner_id -> subscriptions).
  try {
    const url = new URL(`${supabaseUrl}/rest/v1/business`);
    url.searchParams.set('select', 'owner_id');
    url.searchParams.set('id', `eq.${businessId}`);
    url.searchParams.set('limit', '1');

    const res = await fetch(url.toString(), {
      headers: {
        apikey: sk,
        Authorization: `Bearer ${sk}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (res.ok) {
      const rows = (await res.json().catch(() => [])) as any[];
      const ownerId = String(rows?.[0]?.owner_id ?? '').trim();
      if (ownerId) {
        return await getSubscriptionForOwner(ownerId);
      }
    }
  } catch {
    // ignore
  }

  return { status: 'inactive', plan: 'none' };
}

async function getBusinessMemberForUser(userId: string): Promise<{
  business_id: string;
  role: string | null;
} | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    null;
  if (!supabaseUrl || !serviceKey) return null;
  const sk = serviceKey as string;

  const url = new URL(`${supabaseUrl}/rest/v1/business_members`);
  url.searchParams.set('select', 'business_id,role');
  url.searchParams.set('user_id', `eq.${userId}`);
  url.searchParams.set('order', 'created_at.asc');
  url.searchParams.set('limit', '1');

  const res = await fetch(url.toString(), {
    headers: {
      apikey: sk,
      Authorization: `Bearer ${sk}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const rows = (await res.json().catch(() => [])) as any[];
  const r = rows?.[0] ?? null;
  if (!r?.business_id) return null;
  return {
    business_id: String(r.business_id),
    role: r.role === null || r.role === undefined ? null : String(r.role),
  };
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Ignore Next internals / assets
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.jpeg') ||
    pathname.endsWith('.webp') ||
    pathname.endsWith('.gif') ||
    pathname.endsWith('.ico')
  ) {
    return NextResponse.next();
  }

  const isApi = pathname.startsWith('/api/');

  if (!isApi && isPublicPath(pathname)) return NextResponse.next();
  if (isApi && isPublicApi(pathname)) return NextResponse.next();

  const token = getBearerToken(req);
  if (!token) {
    if (isApi) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  const payload = decodeJwtPayload(token);
  const userId = String(payload?.sub ?? '');
  const exp = Number(payload?.exp ?? 0);
  if (!userId || !Number.isFinite(exp) || Date.now() > exp * 1000) {
    if (isApi) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  // Authenticated, but subscription gating is skipped for certain routes.
  if (!isApi && isAuthOnlyNoSubscriptionPath(pathname)) {
    return NextResponse.next();
  }

  // Admin bypass: authenticated admin users skip subscription gating.
  const email = await getEmailForToken(token, payload);
  if (email && ADMIN_EMAILS.includes(email)) {
    return NextResponse.next();
  }

  // Role-based routing: main + sub-accounts via business_members (fallback to profiles.role).
  const member = await getBusinessMemberForUser(userId);
  const prof = await getProfileForUser(userId);
  const role = String(member?.role ?? prof?.role ?? '').toLowerCase();
  const isEmployee = role === 'employee';

  if (isEmployee) {
    const allowedPagePrefixes = ['/clock'];
    const allowedApiPrefixes: string[] = []; // employees should not call app APIs

    if (isApi) {
      const ok = allowedApiPrefixes.some((p) => pathname.startsWith(p));
      if (!ok) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else {
      const ok = allowedPagePrefixes.some((p) => pathname.startsWith(p));
      if (!ok) {
        const url = req.nextUrl.clone();
        url.pathname = '/clock';
        return NextResponse.redirect(url);
      }
    }
  }

  const sub = isEmployee && (member?.business_id || prof?.business_id)
    ? await getSubscriptionForBusinessId(String(member?.business_id ?? prof?.business_id))
    : await getSubscriptionForOwner(userId);

  const required = requiredPlanForPath(pathname);
  if (required) {
    if (sub.status !== 'active') {
      if (isApi) {
        return NextResponse.json({ error: 'Upgrade required' }, { status: 403 });
      }
      const url = req.nextUrl.clone();
      url.pathname = '/pricing';
      url.searchParams.set('upgrade', required);
      url.searchParams.set('reason', 'upgrade_required');
      url.searchParams.set('redirect', pathname);
      return NextResponse.redirect(url);
    }

    if (!atLeast(sub.plan, required)) {
      if (isApi) {
        return NextResponse.json({ error: 'Upgrade required' }, { status: 403 });
      }
      const url = req.nextUrl.clone();
      url.pathname = '/pricing';
      url.searchParams.set('upgrade', required);
      url.searchParams.set('current', sub.plan);
      url.searchParams.set('reason', 'upgrade_required');
      url.searchParams.set('redirect', pathname);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};


