import { NextResponse, type NextRequest } from 'next/server';

function hasSessionCookie(req: NextRequest): boolean {
  const rgAt = req.cookies.get('rg_at')?.value ?? null;
  if (rgAt) return true;

  // Supabase SSR cookies vary by project. Be permissive.
  const names = req.cookies.getAll().map((c) => c.name);
  return (
    names.some((n) => n.startsWith('sb-') && n.endsWith('-auth-token')) ||
    names.includes('sb-access-token') ||
    names.includes('sb-refresh-token')
  );
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

  const protect = pathname.startsWith('/dashboard/') || pathname === '/dashboard' || pathname.startsWith('/app/');
  // eslint-disable-next-line no-console
  console.log('MW_CHECK', { pathname, protect });

  if (!protect) return NextResponse.next();

  const hasSession = hasSessionCookie(req);
  // eslint-disable-next-line no-console
  console.log('MW_DECISION', { pathname, hasSession, decision: hasSession ? 'allow' : 'redirect_login' });

  if (hasSession) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/dashboard/:path*', '/app/:path*'],
};


