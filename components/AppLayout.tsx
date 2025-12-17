'use client';

// AppLayout: shared shell with a dark left sidebar (QuickBooks-style) and main content area.
// Used by all primary app pages (dashboard, transactions, invoices, etc.) to keep layout consistent.

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '../utils/supabaseClient';

type NavItem = {
  label: string;
  href: string;
};

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/' },
  { label: 'Transactions', href: '/transactions' },
  { label: 'Invoices', href: '/invoices' },
  { label: 'Bills', href: '/bills' },
  { label: 'Customers', href: '/customers' },
  { label: 'AI Advisor', href: '/ai-advisor' },
  { label: 'Reports', href: '/reports' },
  { label: 'Pricing', href: '/pricing' },
];

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [appResetKey, setAppResetKey] = useState(0);

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

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setEmail(data.session?.user?.email ?? null);
      setSessionUserId(data.session?.user?.id ?? null);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const nextEmail = session?.user?.email ?? null;
      const nextUserId = session?.user?.id ?? null;

      // Hard reset app state whenever the auth identity changes.
      if (nextUserId !== sessionUserId) {
        clearAppClientCache();
        setAppResetKey((k) => k + 1);
      }

      setEmail(nextEmail);
      setSessionUserId(nextUserId);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function logout() {
    setSigningOut(true);
    try {
      clearAppClientCache();
      await supabase.auth.signOut();
      router.push('/login?redirect=/dashboard');
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-slate-950 text-slate-50">
      {/* Sidebar */}
      <aside className="no-print hidden md:flex md:flex-col w-60 bg-slate-950 border-r border-slate-800/80 px-4 py-5">
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-400 via-sky-400 to-blue-500 shadow-lg shadow-emerald-500/40" />
            <div>
              <div className="text-sm font-semibold tracking-tight">
                RevGuard
              </div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
                AI ACCOUNTING
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 text-sm">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 transition-colors ${
                  active
                    ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/40 shadow-sm shadow-emerald-500/40'
                    : 'text-slate-300 hover:text-slate-50 hover:bg-slate-900/80 border border-transparent'
                }`}
              >
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-4 pt-3 border-t border-slate-800">
          {email ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-3 shadow-[0_0_0_1px_rgba(148,163,184,0.06)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Account
                  </div>
                  <div className="mt-1 text-[12px] text-slate-300 truncate">
                    {email}
                  </div>
                </div>
              </div>
              <div className="my-3 h-px bg-slate-800/80" />
              <button
                type="button"
                onClick={logout}
                disabled={signingOut}
                className="inline-flex items-center justify-center rounded-xl border border-slate-800 bg-slate-950/30 px-3 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-900/70 disabled:opacity-50"
              >
                {signingOut ? 'Logging out…' : 'Log out'}
              </button>
            </div>
          ) : (
            <div className="text-[11px] text-slate-400 space-y-2">
              <div>
                <div>Signed in as</div>
                <div className="font-medium text-slate-100">Not signed in</div>
              </div>
              <Link
                href="/login?redirect=/dashboard"
                className="block rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200 hover:bg-emerald-500/15"
              >
                Log in
              </Link>
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950">
        <div className="no-print md:hidden sticky top-0 z-40 flex items-center justify-between px-4 py-3 border-b border-slate-800/80 bg-slate-950/95 backdrop-blur">
          <div>
            <div className="text-sm font-semibold tracking-tight">
              RevGuard
            </div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
              AI ACCOUNTING
            </div>
          </div>
          {email ? (
            <div className="flex items-center gap-2">
              <div className="hidden sm:block text-[11px] text-slate-400 max-w-[180px] truncate">
                {email}
              </div>
              <button
                type="button"
                onClick={logout}
                disabled={signingOut}
                className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px] font-semibold text-slate-200 hover:bg-slate-900/70 disabled:opacity-50"
              >
                {signingOut ? '…' : 'Log out'}
              </button>
            </div>
          ) : (
            <Link
              href="/login?redirect=/dashboard"
              className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200 hover:bg-emerald-500/15"
            >
              Log in
            </Link>
          )}
        </div>
        <div
          key={`${sessionUserId ?? 'anon'}:${appResetKey}`}
          className="max-w-6xl mx-auto px-4 py-8 md:py-10"
        >
          {children}
        </div>
      </div>
    </div>
  );
}


