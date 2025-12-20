'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import AppLayout from './AppLayout';
import KeepAliveTabs from './KeepAliveTabs';
import ReactQueryProvider from './ReactQueryProvider';
import { AppDataProvider } from './AppDataProvider';

type Props = {
  children: React.ReactNode;
};

const AUTH_PREFIXES = ['/login', '/signup'];

// Routes that should render inside the app shell (sidebar + tabs).
// Everything else (like the marketing landing page at "/") renders without shell.
const APP_SHELL_PREFIXES = [
  '/dashboard',
  '/transactions',
  '/invoices',
  '/bills',
  '/customers',
  '/ai-advisor',
  '/reports',
  '/settings',
  '/pricing',
  '/billing',
  '/admin',
];

export default function RootShell({ children }: Props) {
  const pathname = usePathname() || '/';
  const isAuth = AUTH_PREFIXES.some((p) => pathname.startsWith(p));
  const hasShell = APP_SHELL_PREFIXES.some((p) => pathname.startsWith(p));

  if (isAuth) {
    // Auth pages should not show the sidebar shell, but should keep the same
    // premium background + centered width container.
    return (
      <div className="min-h-screen bg-slate-950 text-slate-50">
        <div className="max-w-6xl mx-auto px-4 py-10">{children}</div>
      </div>
    );
  }

  if (!hasShell) {
    // Marketing/public pages should not be wrapped by the app shell.
    return <>{children}</>;
  }

  return (
    <ReactQueryProvider>
      <AppLayout>
        <AppDataProvider>
          <KeepAliveTabs>{children}</KeepAliveTabs>
        </AppDataProvider>
      </AppLayout>
    </ReactQueryProvider>
  );
}


