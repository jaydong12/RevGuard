'use client';

import React, { Profiler, useCallback, useMemo, useRef } from 'react';
import { usePathname } from 'next/navigation';

type Props = {
  children: React.ReactNode;
};

// Keep these routes mounted when switching sidebar "tabs".
// This avoids unmount/remount, which otherwise triggers refetch/recompute.
const KEEP_ALIVE_PATHS = new Set<string>([
  '/',
  '/dashboard',
  '/transactions',
  '/invoices',
  '/bills',
  '/customers',
  '/ai-advisor',
  '/reports',
  '/pricing',
]);

const MAX_CACHED_TABS = 10;

export default function KeepAliveTabs({ children }: Props) {
  const pathname = usePathname() || '/';
  const perfEnabled = useMemo(() => {
    try {
      return typeof window !== 'undefined' && localStorage.getItem('revguard:perf') === '1';
    } catch {
      return false;
    }
  }, []);

  const shouldKeepAlive = KEEP_ALIVE_PATHS.has(pathname);
  const cacheRef = useRef<Map<string, React.ReactNode>>(new Map());
  const orderRef = useRef<string[]>([]);

  if (!shouldKeepAlive) {
    return <>{children}</>;
  }

  // Cache the current route's element.
  if (!cacheRef.current.has(pathname)) {
    cacheRef.current.set(pathname, children);
    orderRef.current.push(pathname);
  }

  // Simple eviction to avoid unbounded memory growth.
  if (orderRef.current.length > MAX_CACHED_TABS) {
    const removeCount = orderRef.current.length - MAX_CACHED_TABS;
    const toRemove = orderRef.current.splice(0, removeCount);
    for (const p of toRemove) cacheRef.current.delete(p);
  }

  const entries = useMemo(() => Array.from(cacheRef.current.entries()), [pathname]);

  const onRender = useCallback(
    (
      id: string,
      phase: 'mount' | 'update',
      actualDuration: number,
      baseDuration: number
    ) => {
      if (!perfEnabled) return;
      // eslint-disable-next-line no-console
      console.log('[PERF]', { id, phase, actualMs: Math.round(actualDuration), baseMs: Math.round(baseDuration) });
    },
    [perfEnabled]
  );

  return (
    <>
      {entries.map(([path, node]) => {
        const active = path === pathname;
        const content = (
          <div key={path} style={{ display: active ? 'block' : 'none' }} aria-hidden={!active}>
            {node}
          </div>
        );

        if (!perfEnabled) return content;

        return (
          <Profiler key={path} id={`tab:${path}`} onRender={onRender}>
            {content}
          </Profiler>
        );
      })}
    </>
  );
}


