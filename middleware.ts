import { NextResponse, type NextRequest } from 'next/server';

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/transactions',
  '/invoices',
  '/bills',
  '/customers',
  '/workers',
  '/ai-advisor',
  '/notifications',
  '/reports',
  '/settings',
  '/admin',
  '/billing',
];

function getRgAt(req: NextRequest): string | null {
  const v = req.cookies.get('rg_at')?.value ?? null;
  return v ? decodeURIComponent(v) : null;
}

async function getSupabaseUserIdFromToken(opts: { url: string; anon: string; token: string }) {
  try {
    const res = await fetch(`${opts.url}/auth/v1/user`, {
      headers: {
        apikey: opts.anon,
        Authorization: `Bearer ${opts.token}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as any;
    return json?.id ? String(json.id) : null;
  } catch {
    return null;
  }
}

async function getOnboardingStatus(opts: { url: string; anon: string; token: string; userId: string }) {
  try {
    const q = new URLSearchParams({
      select: 'onboarding_complete,onboarding_step',
      id: `eq.${opts.userId}`,
      limit: '1',
    });
    const res = await fetch(`${opts.url}/rest/v1/profiles?${q.toString()}`, {
      headers: {
        apikey: opts.anon,
        Authorization: `Bearer ${opts.token}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
    if (!res.ok) return { complete: false, step: 'business' as const };
    const rows = (await res.json().catch(() => [])) as any[];
    const p = rows?.[0] ?? null;
    const complete = Boolean(p?.onboarding_complete);
    const stepRaw = String(p?.onboarding_step ?? 'business').trim().toLowerCase();
    const step = stepRaw === 'profile' || stepRaw === 'banking' ? stepRaw : 'business';
    return { complete, step };
  } catch {
    return { complete: false, step: 'business' as const };
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Safety: middleware must never redirect these.
  if (
    pathname === '/login' ||
    pathname.startsWith('/login/') ||
    pathname === '/signup' ||
    pathname.startsWith('/signup/') ||
    pathname === '/reset-password' ||
    pathname.startsWith('/reset-password/') ||
    pathname === '/auth/callback' ||
    pathname.startsWith('/auth/callback') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/')
  ) {
    // eslint-disable-next-line no-console
    console.log('MW_BYPASS', { pathname });
    return NextResponse.next();
  }

  const protect = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!protect) return NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = getRgAt(req);
  if (!url || !anon || !token) {
    const to = req.nextUrl.clone();
    to.pathname = '/login';
    to.search = '';
    return NextResponse.redirect(to);
  }

  return (async () => {
    const userId = await getSupabaseUserIdFromToken({ url, anon, token });
    if (!userId) {
      const to = req.nextUrl.clone();
      to.pathname = '/login';
      to.search = '';
      return NextResponse.redirect(to);
    }

    const status = await getOnboardingStatus({ url, anon, token, userId });
    if (status.complete) return NextResponse.next();

    const to = req.nextUrl.clone();
    to.pathname = `/onboarding/${status.step}`;
    to.search = '';
    return NextResponse.redirect(to);
  })();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/transactions/:path*',
    '/invoices/:path*',
    '/bills/:path*',
    '/customers/:path*',
    '/workers/:path*',
    '/ai-advisor/:path*',
    '/notifications/:path*',
    '/reports/:path*',
    '/settings/:path*',
    '/admin/:path*',
    '/billing/:path*',
  ],
};


