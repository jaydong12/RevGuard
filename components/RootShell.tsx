'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import AppLayout from './AppLayout';
import KeepAliveTabs from './KeepAliveTabs';
import { TransactionsCacheProvider } from './TransactionsCacheProvider';

type Props = {
  children: React.ReactNode;
};

const NO_SHELL_PREFIXES = ['/login', '/signup'];

export default function RootShell({ children }: Props) {
  const pathname = usePathname() || '/';
  const noShell = NO_SHELL_PREFIXES.some((p) => pathname.startsWith(p));

  if (noShell) {
    // Auth pages should not show the sidebar shell, but should keep the same
    // premium background + centered width container.
    return (
      <div className="min-h-screen bg-slate-950 text-slate-50">
        <div className="max-w-6xl mx-auto px-4 py-10">{children}</div>
      </div>
    );
  }

  return (
    <AppLayout>
      <TransactionsCacheProvider>
        <KeepAliveTabs>{children}</KeepAliveTabs>
      </TransactionsCacheProvider>
    </AppLayout>
  );
}


