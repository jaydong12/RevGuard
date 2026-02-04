"use client";

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import React, { useMemo } from 'react';
import { Building2, CreditCard, Landmark, Shield, User } from 'lucide-react';

type SettingsTabKey = 'business' | 'profile' | 'security' | 'banking' | 'billing';

function normalizeTab(raw: string | null): Exclude<SettingsTabKey, 'banking'> {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'business' || v === 'profile' || v === 'security' || v === 'billing') return v;
  return 'business';
}

export function SettingsTabs() {
  const pathname = usePathname();
  const sp = useSearchParams();

  const active = useMemo<SettingsTabKey>(() => {
    if (pathname === '/settings/banking' || pathname?.startsWith('/settings/banking/')) return 'banking';
    return normalizeTab(sp.get('tab'));
  }, [pathname, sp]);

  const tabs: Array<{ key: SettingsTabKey; label: string; href: string; icon: React.ReactNode }> = [
    { key: 'business', label: 'Business', href: '/settings?tab=business', icon: <Building2 className="h-4 w-4" /> },
    { key: 'profile', label: 'Profile', href: '/settings?tab=profile', icon: <User className="h-4 w-4" /> },
    { key: 'security', label: 'Security', href: '/settings?tab=security', icon: <Shield className="h-4 w-4" /> },
    { key: 'banking', label: 'Banking', href: '/settings/banking', icon: <Landmark className="h-4 w-4" /> },
    { key: 'billing', label: 'Billing', href: '/settings?tab=billing', icon: <CreditCard className="h-4 w-4" /> },
  ];

  return (
    <div className="sticky top-0 z-40 -mx-2 px-2 pt-1 pb-2">
      <div className="mx-auto w-full max-w-5xl">
        <div className="overflow-x-auto">
          <div className="min-w-[560px] grid grid-cols-5 gap-1 rounded-2xl border border-slate-800 bg-slate-950/60 p-1 shadow-sm">
            {tabs.map((t) => {
              const selected = active === t.key;
              return (
                <Link
                  key={t.key}
                  href={t.href}
                  className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                    selected
                      ? 'bg-white/10 text-slate-50 border border-white/10 shadow-sm'
                      : 'text-slate-300 hover:text-slate-50 hover:bg-white/5 border border-transparent'
                  }`}
                  aria-current={selected ? 'page' : undefined}
                  prefetch={false}
                >
                  <span className={selected ? 'text-emerald-200' : 'text-slate-400'}>{t.icon}</span>
                  <span>{t.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}


