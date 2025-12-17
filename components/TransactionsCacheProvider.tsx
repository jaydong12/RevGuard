'use client';

import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';

type CacheValue = {
  /** Returns cached transactions for a business, if present. */
  getTransactions: <T = any>(businessId: string) => T[] | null;
  /** Stores transactions for a business. */
  setTransactions: <T = any>(businessId: string, rows: T[]) => void;
  /** Clears one business cache or all caches. */
  clearTransactions: (businessId?: string) => void;
};

const TransactionsCacheContext = createContext<CacheValue | null>(null);

export function TransactionsCacheProvider({ children }: { children: React.ReactNode }) {
  const mapRef = useRef<Map<string, any[]>>(new Map());

  const getTransactions = useCallback(<T = any,>(businessId: string) => {
    return (mapRef.current.get(businessId) as T[] | undefined) ?? null;
  }, []);

  const setTransactions = useCallback(<T = any,>(businessId: string, rows: T[]) => {
    mapRef.current.set(businessId, rows as any[]);
  }, []);

  const clearTransactions = useCallback((businessId?: string) => {
    if (businessId) mapRef.current.delete(businessId);
    else mapRef.current.clear();
  }, []);

  const value = useMemo(
    () => ({ getTransactions, setTransactions, clearTransactions }),
    [getTransactions, setTransactions, clearTransactions]
  );

  return (
    <TransactionsCacheContext.Provider value={value}>
      {children}
    </TransactionsCacheContext.Provider>
  );
}

export function useTransactionsCache() {
  const ctx = useContext(TransactionsCacheContext);
  if (!ctx) {
    throw new Error('useTransactionsCache must be used within TransactionsCacheProvider');
  }
  return ctx;
}


