'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import AppLayout from './AppLayout';
import KeepAliveTabs from './KeepAliveTabs';
import ReactQueryProvider from './ReactQueryProvider';
import { AppDataProvider } from './AppDataProvider';
import { ToastProvider } from './ToastProvider';
import { HealthGate } from './HealthGate';
import { OneTimeClientCleanup } from './OneTimeClientCleanup';

type Props = {
  children: React.ReactNode;
};

const AUTH_PREFIXES = ['/login', '/signup', '/reset-password'];
const CLOCK_PREFIXES = ['/clock', '/employee'];

// Routes that should render inside the app shell (sidebar + tabs).
// Everything else (like the marketing landing page at "/") renders without shell.
const APP_SHELL_PREFIXES = [
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
  '/pricing',
  '/billing',
  '/admin',
];

export default function RootShell({ children }: Props) {
  const pathname = usePathname() || '/';
  const isAuth = AUTH_PREFIXES.some((p) => pathname.startsWith(p));
  const isClock = CLOCK_PREFIXES.some((p) => pathname.startsWith(p));
  const hasShell = APP_SHELL_PREFIXES.some((p) => pathname.startsWith(p));

  if (isAuth) {
    // Auth pages should not show the sidebar shell, but should keep the same
    // premium background + centered width container.
    return (
      <div className="min-h-screen bg-slate-950 text-slate-50">
        <OneTimeClientCleanup />
        <div className="max-w-6xl mx-auto px-4 py-10">
          <HealthGate>{children}</HealthGate>
        </div>
      </div>
    );
  }

  if (isClock) {
    // Employee clock should not show the sidebar shell.
    return (
      <ReactQueryProvider>
        <ToastProvider>
          <div className="min-h-screen bg-slate-950 text-slate-50">
            <OneTimeClientCleanup />
            <div className="max-w-3xl mx-auto px-4 py-10">
              <HealthGate>{children}</HealthGate>
            </div>
          </div>
        </ToastProvider>
      </ReactQueryProvider>
    );
  }

  if (!hasShell) {
    // Marketing/public pages should not be wrapped by the app shell.
    return <>{children}</>;
  }

  return (
    <ReactQueryProvider>
      <ToastProvider>
        <OneTimeClientCleanup />
        <HealthGate>
          <AppLayout>
            <AppDataProvider>
              <KeepAliveTabs>{children}</KeepAliveTabs>
            </AppDataProvider>
          </AppLayout>
        </HealthGate>
      </ToastProvider>
    </ReactQueryProvider>
  );
}


