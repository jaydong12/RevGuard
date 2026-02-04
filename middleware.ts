import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

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

const ONBOARDING_PREFIXES = ['/onboarding'];

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

  const res = NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    // Fail closed for protected routes.
    const to = req.nextUrl.clone();
    to.pathname = '/login';
    to.search = '';
    return NextResponse.redirect(to);
  }

  const supabase = createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        return req.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: any) {
        res.cookies.set(name, value, options);
      },
      remove(name: string, options: any) {
        res.cookies.set(name, '', { ...options, maxAge: 0 });
      },
    },
  });

  return (async () => {
    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user ?? null;
    if (!user?.id) {
      const to = req.nextUrl.clone();
      to.pathname = '/login';
      to.search = '';
      return NextResponse.redirect(to);
    }

    // Onboarding gate: users must complete onboarding before entering the app.
    // Only enforce on protected routes (avoid loops).
    const { data: profile } = await supabase
      .from('profiles')
      .select('onboarding_complete,onboarding_step')
      .eq('id', user.id)
      .maybeSingle();

    const complete = Boolean((profile as any)?.onboarding_complete);
    if (complete) return res;

    const stepRaw = String((profile as any)?.onboarding_step ?? 'business').trim().toLowerCase();
    const step = stepRaw === 'profile' || stepRaw === 'banking' ? stepRaw : 'business';
    const dest = `/onboarding/${step}`;

    // If already on onboarding routes, do nothing (shouldn't happen due to matcher, but be safe).
    if (ONBOARDING_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return res;

    const to = req.nextUrl.clone();
    to.pathname = dest;
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


