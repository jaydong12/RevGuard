'use client';

// AppLayout: shared shell with a dark left sidebar (QuickBooks-style) and main content area.
// Used by all primary app pages (dashboard, transactions, invoices, etc.) to keep layout consistent.

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { getSupabaseClient, getSupabaseEnvError } from '../utils/supabaseClient';

function setAuthCookie(token: string | null) {
  try {
    if (!token) {
      document.cookie = `rg_at=; Path=/; Max-Age=0; SameSite=Lax`;
      return;
    }
    // JS-readable cookie so middleware can gate routes. (Auth is already in localStorage.)
    document.cookie = `rg_at=${encodeURIComponent(token)}; Path=/; Max-Age=604800; SameSite=Lax`;
  } catch {
    // ignore
  }
}

type NavItem = {
  label: string;
  href: string;
  icon:
    | 'dashboard'
    | 'transactions'
    | 'bookings'
    | 'workers'
    | 'invoices'
    | 'bills'
    | 'customers'
    | 'ai'
    | 'reports'
    | 'pricing'
    | 'settings';
};

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: 'dashboard' },
  { label: 'Transactions', href: '/transactions', icon: 'transactions' },
  { label: 'Bookings', href: '/dashboard/bookings', icon: 'bookings' },
  { label: 'Workers', href: '/workers', icon: 'workers' },
  { label: 'Invoices', href: '/invoices', icon: 'invoices' },
  { label: 'Bills', href: '/bills', icon: 'bills' },
  { label: 'Customers', href: '/customers', icon: 'customers' },
  { label: 'AI Advisor', href: '/ai-advisor', icon: 'ai' },
  { label: 'Reports', href: '/reports', icon: 'reports' },
  { label: 'Settings', href: '/settings', icon: 'settings' },
  { label: 'Pricing', href: '/pricing', icon: 'pricing' },
];

function isActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavIcon({ name }: { name: NavItem['icon'] }) {
  const common = 'h-4 w-4 shrink-0';
  if (name === 'dashboard') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true">
        <path
          d="M4 13.5V6.8c0-.8.6-1.5 1.4-1.6l5-.8c1-.1 1.8.6 1.8 1.6v7.5c0 .9-.7 1.6-1.6 1.6H5.6c-.9 0-1.6-.7-1.6-1.6Z"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M12.8 13.5V10c0-.9.7-1.6 1.6-1.6h4c.9 0 1.6.7 1.6 1.6v7.8c0 .9-.7 1.6-1.6 1.6h-4c-.9 0-1.6-.7-1.6-1.6v-1.8"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (name === 'transactions') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true">
        <path d="M7 7h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M7 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M7 17h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M3 7h.01M3 12h.01M3 17h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'bookings') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true">
        <path
          d="M7 3v3M17 3v3"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M4 7h16"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M6 5h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M8.5 11h3M13.5 11h3M8.5 15h3M13.5 15h3"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (name === 'workers') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true">
        <path
          d="M16 11a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M4.5 20c1.2-3.3 13.8-3.3 15 0"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M20.5 10.8a2.3 2.3 0 1 1-4.6 0"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.7"
        />
      </svg>
    );
  }
  if (name === 'invoices') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true">
        <path
          d="M7 3h8l3 3v15l-2-1-2 1-2-1-2 1-2-1-2 1V3Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M9 10h6M9 14h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'bills') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true">
        <path
          d="M6 3h12v18l-2-1-2 1-2-1-2 1-2-1-2 1V3Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M8.5 10h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M8.5 14h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'customers') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true">
        <path
          d="M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0Z"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M4 21c1.5-4 14.5-4 16 0"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (name === 'ai') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true">
        <path
          d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"
          stroke="currentColor"
          strokeWidth="2"
        />
      </svg>
    );
  }
  if (name === 'reports') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true">
        <path d="M4 19V5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M4 19h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M8 15v-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M12 15V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M16 15v-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'pricing') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true">
        <path
          d="M7 7h10l-1 12H8L7 7Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M9 7a3 3 0 0 1 6 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  // settings
  return (
    <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true">
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M19.4 15a8 8 0 0 0 .1-2l2-1.2-2-3.5-2.3.6a8 8 0 0 0-1.7-1l-.3-2.4H11l-.3 2.4a8 8 0 0 0-1.7 1l-2.3-.6-2 3.5 2 1.2a8 8 0 0 0 0 2l-2 1.2 2 3.5 2.3-.6a8 8 0 0 0 1.7 1L11 22h4l.3-2.4a8 8 0 0 0 1.7-1l2.3.6 2-3.5-2-1.2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = getSupabaseClient();
  const supabaseEnvError = getSupabaseEnvError();
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [memberRole, setMemberRole] = useState<string | null>(null);
  const [appResetKey, setAppResetKey] = useState(0);
  const [subscriptionActive, setSubscriptionActive] = useState<boolean>(true);
  const [subscriptionChecked, setSubscriptionChecked] = useState<boolean>(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  // IMPORTANT: Avoid reading window/localStorage during render to prevent hydration mismatches.
  // Use a deterministic default for the first render, then hydrate from localStorage in an effect.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    // Persisted sidebar state (desktop)
    try {
      const raw = localStorage.getItem('sidebarCollapsed');
      if (raw === '1' || raw === 'true') setSidebarCollapsed(true);
    } catch {
      // ignore
    }
  }, []);

  // user_activity ping lives in <UserActivityPing /> (10-min heartbeat)

  // Membership role (business_members) determines nav visibility for sub-accounts.
  useEffect(() => {
    let cancelled = false;
    async function loadMemberRole() {
      try {
        if (!sessionUserId) return;
        if (!supabase) return;
        const { data, error } = await supabase
          .from('business_members')
          .select('role')
          .eq('user_id', sessionUserId)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          setMemberRole(null);
          return;
        }
        const r = String((data as any)?.role ?? '').toLowerCase();
        setMemberRole(r || null);
      } catch {
        if (!cancelled) setMemberRole(null);
      }
    }
    void loadMemberRole();
    return () => {
      cancelled = true;
    };
  }, [sessionUserId]);

  const navItems = memberRole === 'employee'
    ? ([{ label: 'Clock', href: '/clock', icon: 'workers' }] as NavItem[])
    : NAV_ITEMS;

  const bottomNavItems: Array<{ label: string; href: string; icon: NavItem['icon'] }> = [
    { label: 'Home', href: '/dashboard', icon: 'dashboard' },
    // Mobile label "Alerts" maps to existing AI Advisor route (no new routes).
    { label: 'Alerts', href: '/ai-advisor', icon: 'ai' },
    { label: 'Transactions', href: '/transactions', icon: 'transactions' },
    { label: 'Invoices', href: '/invoices', icon: 'invoices' },
  ];

  const moreNavItems = navItems.filter(
    (it) =>
      !bottomNavItems.some((b) => b.href === it.href) &&
      it.href !== '/pricing' // keep pricing accessible via sidebar/desktop; keep mobile More focused
  );

  async function getSubscriptionActiveForOwner(userId: string): Promise<boolean> {
    if (!supabase) return false;
    const first = await supabase
      .from('business')
      .select('id, subscription_status')
      .eq('owner_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    // If the row doesn't exist yet (trigger not applied / race), treat as inactive (paywall).
    if (first.error || !first.data?.id) return false;

    const status = String((first.data as any)?.subscription_status ?? 'inactive').toLowerCase();
    return status === 'active';
  }

  function clearAppClientCache() {
    try {
      // Clear RevGuard-specific app cache keys (do NOT touch Supabase auth keys).
      const extraKeys = [
        'selectedBusinessId',
        'activeBusinessId',
        'businessId',
        'chatHistory',
        'imports',
      ];
      for (const k of extraKeys) {
        try {
          localStorage.removeItem(k);
          sessionStorage.removeItem(k);
        } catch {
          // ignore
        }
      }

      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.startsWith('revguard:')) localStorage.removeItem(key);
      }
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (!key) continue;
        if (key.startsWith('revguard:')) sessionStorage.removeItem(key);
      }
    } catch {
      // ignore storage errors (private mode etc)
    }
  }

  function toggleSidebarCollapsed() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('sidebarCollapsed', String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  useEffect(() => {
    let mounted = true;
    const sb = supabase;

    async function checkSubscription(session: any | null) {
      try {
        const email = String(session?.user?.email ?? '').trim().toLowerCase();
        if (email && (email === 'jaydongant@gmail.com' || email === 'shannon_g75@yahoo.com')) {
          if (!mounted) return;
          setSubscriptionActive(true);
          setSubscriptionChecked(true);
          return;
        }

        const userId = session?.user?.id ?? null;
        if (!userId) {
          if (!mounted) return;
          setSubscriptionActive(true);
          setSubscriptionChecked(true);
          return;
        }

        const isActive = await getSubscriptionActiveForOwner(userId);
        if (!mounted) return;
        setSubscriptionActive(isActive);
        setSubscriptionChecked(true);
      } catch {
        if (!mounted) return;
        setSubscriptionActive(false);
        setSubscriptionChecked(true);
      }
    }

    if (!sb) {
      setSessionUserId(null);
      setAuthCookie(null);
      setSubscriptionActive(false);
      setSubscriptionChecked(true);
      return () => {
        mounted = false;
      };
    }

    const sbn = sb;

    (async () => {
      const { data } = await sbn.auth.getSession();
      if (!mounted) return;
      setSessionUserId(data.session?.user?.id ?? null);
      setAuthCookie(data.session?.access_token ?? null);
      void checkSubscription(data.session ?? null);
    })();

    const { data: sub } = sbn.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const nextUserId = session?.user?.id ?? null;

      // Hard reset app state whenever the auth identity changes.
      if (nextUserId !== sessionUserId) {
        clearAppClientCache();
        setAppResetKey((k) => k + 1);
      }

      setSessionUserId(nextUserId);
      setAuthCookie(session?.access_token ?? null);
      void checkSubscription(session ?? null);
    });

    function onFocus() {
      // Re-check on focus so users returning from Stripe can unlock without a hard refresh.
      void sbn.auth.getSession().then(({ data }) => checkSubscription(data.session ?? null));
    }
    window.addEventListener('focus', onFocus);

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, [supabase, sessionUserId]);

  useEffect(() => {
    // NOTE: We no longer hard-redirect users to /pricing when subscription is inactive.
    // Navigation should always work; individual pages can decide how to present paywalls.
    // (Kept subscription state for pricing UI / future feature-gating.)
  }, []);

  useEffect(() => {
    // Auto-unlock: while paywalled, poll periodically so Stripe webhook changes take effect without refresh.
    if (!subscriptionChecked) return;
    if (subscriptionActive) return;
    if (!supabase) return;

    let cancelled = false;
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const { data } = await supabase.auth.getSession();
          const userId = data.session?.user?.id ?? null;
          if (!userId) return;
          const isActive = await getSubscriptionActiveForOwner(userId);
          if (cancelled) return;
          if (isActive) {
            setSubscriptionActive(true);
          }
        } catch {
          // ignore
        }
      })();
    }, 8000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [subscriptionChecked, subscriptionActive]);

  if (!mounted) {
    // Keep markup stable between server + first client render, while still running hooks in a stable order.
    return <div className="min-h-screen bg-slate-950 text-slate-50" />;
  }

  if (supabaseEnvError) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-50">
        <div className="max-w-3xl mx-auto px-4 py-10">
          <div className="rounded-2xl border border-rose-500/40 bg-rose-950/20 p-5">
            <div className="text-sm font-semibold text-rose-100">Configuration error</div>
            <div className="mt-2 text-sm text-rose-200/90 leading-relaxed">
              {supabaseEnvError}
            </div>
            <div className="mt-4 text-xs text-rose-200/80">
              This usually happens when Vercel env vars are missing or named incorrectly.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-950 text-slate-50">
      {/* Sidebar */}
      <aside
        className={`no-print hidden md:flex md:flex-col bg-slate-950 border-r border-slate-800/80 py-5 transition-all duration-200 ${
          sidebarCollapsed ? 'w-16 px-2' : 'w-60 px-4'
        }`}
      >
        <div className="mb-4">
          <div className="flex h-12 items-center justify-between gap-3">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 min-w-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              aria-label="Go to dashboard"
              title="Go to dashboard"
            >
              <Image
                src="/logo.png"
                alt="RevGuard"
                width={32}
                height={32}
                className="h-8 w-8"
                priority
              />
              {!sidebarCollapsed ? (
                <div className="min-w-0">
                  <div className="text-sm font-semibold tracking-tight truncate">
                    RevGuard
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400 truncate">
                    AI ACCOUNTING
                  </div>
                </div>
              ) : null}
            </Link>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleSidebarCollapsed}
                className="inline-flex items-center justify-center rounded-xl border border-slate-800 bg-slate-950/40 p-2 text-[11px] font-semibold text-slate-200 hover:bg-slate-900/70"
                aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                  <path
                    d={sidebarCollapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'}
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <nav className="h-full space-y-1 text-sm overflow-y-auto pr-1">
            {navItems.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={sidebarCollapsed ? item.label : undefined}
                  className={`flex items-center rounded-xl py-2 transition-colors ${
                    active
                      ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/40 shadow-sm shadow-emerald-500/40'
                      : 'text-slate-300 hover:text-slate-50 hover:bg-slate-900/80 border border-transparent'
                  } ${sidebarCollapsed ? 'justify-center px-2' : 'gap-2 px-3'}`}
                >
                  <NavIcon name={item.icon} />
                  <span className={sidebarCollapsed ? 'hidden' : 'truncate'}>
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950">
        <div className="no-print md:hidden sticky top-0 z-40 flex items-center justify-between px-4 py-3 border-b border-slate-800/80 bg-slate-950/95 backdrop-blur">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 min-w-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            aria-label="Go to dashboard"
          >
            <Image
              src="/logo.png"
              alt="RevGuard"
              width={28}
              height={28}
              className="h-7 w-7"
              priority
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-tight truncate">
                RevGuard
              </div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400 truncate">
                AI ACCOUNTING
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/settings"
              className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px] font-semibold text-slate-200 hover:bg-slate-900/70"
              aria-label="Settings"
              title="Settings"
              onClick={() => setMobileNavOpen(false)}
            >
              <span className="inline-flex items-center gap-2">
                <NavIcon name="settings" />
                <span className="hidden sm:inline">Settings</span>
              </span>
            </Link>
            <button
              type="button"
              onClick={() => setMobileMoreOpen(true)}
              className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px] font-semibold text-slate-200 hover:bg-slate-900/70"
              aria-label="Open more menu"
            >
              More
            </button>
          </div>
        </div>

        {/* Mobile “More” sheet */}
        <div
          className={`no-print md:hidden fixed inset-0 z-[95] transition-opacity duration-200 ${
            mobileMoreOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          <button
            type="button"
            aria-label="Close more menu"
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileMoreOpen(false)}
          />

          <div
            className={`absolute inset-x-0 bottom-0 rounded-t-2xl bg-slate-950 border-t border-slate-800 p-4 pb-6 transition-transform duration-200 ${
              mobileMoreOpen ? 'translate-y-0' : 'translate-y-full'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-100">More</div>
              <button
                type="button"
                onClick={() => setMobileMoreOpen(false)}
                className="rounded-lg border border-slate-800 bg-slate-950/30 px-2 py-1 text-xs text-slate-200"
              >
                Close
              </button>
            </div>

            <nav className="mt-4 grid grid-cols-2 gap-2 text-sm">
              {moreNavItems.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMoreOpen(false)}
                    className={`flex items-center gap-2 rounded-xl px-3 py-3 transition-colors ${
                      active
                        ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/40'
                        : 'text-slate-300 hover:text-slate-50 hover:bg-slate-900/80 border border-white/10 bg-white/5'
                    }`}
                  >
                    <NavIcon name={item.icon} />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
              {/* Keep Pricing reachable on mobile via More */}
              <Link
                href="/pricing"
                onClick={() => setMobileMoreOpen(false)}
                className="flex items-center gap-2 rounded-xl px-3 py-3 transition-colors text-slate-300 hover:text-slate-50 hover:bg-slate-900/80 border border-white/10 bg-white/5"
              >
                <NavIcon name="pricing" />
                <span className="truncate">Pricing</span>
              </Link>
            </nav>
          </div>
        </div>

        <div
          key={`${sessionUserId ?? 'anon'}:${appResetKey}`}
          className="max-w-6xl mx-auto px-4 py-8 pb-24 md:pb-10 md:py-10"
        >
          {children}
        </div>

        {/* Mobile bottom nav */}
        <div className="no-print md:hidden fixed inset-x-0 bottom-0 z-[80] border-t border-slate-800/80 bg-slate-950/95 backdrop-blur">
          <div className="mx-auto max-w-6xl px-3 py-2">
            <div className="grid grid-cols-5 gap-1">
              {bottomNavItems.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <button
                    key={item.href}
                    type="button"
                    onClick={() => router.push(item.href)}
                    className={`flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[10px] transition ${
                      active
                        ? 'text-emerald-200 bg-emerald-500/10 border border-emerald-500/30'
                        : 'text-slate-300 hover:text-slate-50 hover:bg-white/5 border border-transparent'
                    }`}
                  >
                    <span className="text-slate-200">{<NavIcon name={item.icon} />}</span>
                    <span className="leading-none">{item.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setMobileMoreOpen(true)}
                className={`flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[10px] transition ${
                  mobileMoreOpen
                    ? 'text-emerald-200 bg-emerald-500/10 border border-emerald-500/30'
                    : 'text-slate-300 hover:text-slate-50 hover:bg-white/5 border border-transparent'
                }`}
                aria-label="Open more"
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                  <path d="M6 12h.01M12 12h.01M18 12h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                <span className="leading-none">More</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


