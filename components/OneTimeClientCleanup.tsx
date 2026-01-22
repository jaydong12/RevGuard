'use client';

import { useEffect } from 'react';

export function OneTimeClientCleanup() {
  useEffect(() => {
    let cancelled = false;
    const key = 'revguard:client_cleanup_v1';
    try {
      if (typeof window === 'undefined') return;
      if (window.localStorage.getItem(key) === '1') return;
      window.localStorage.setItem(key, '1');
    } catch {
      // ignore
    }

    (async () => {
      try {
        if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const r of regs) {
            await r.unregister().catch(() => null);
          }
        }

        if (typeof caches !== 'undefined' && caches?.keys) {
          const keys = await caches.keys().catch(() => []);
          for (const k of keys) {
            if (cancelled) return;
            await caches.delete(k).catch(() => null);
          }
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}


