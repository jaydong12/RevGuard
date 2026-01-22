import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null | undefined;
let _initError: string | null | undefined;

function fetchWithTimeout(timeoutMs: number) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(input, { ...(init ?? {}), signal: controller.signal });
      return res;
    } catch (e: any) {
      if (String(e?.name ?? '') === 'AbortError') {
        throw new Error('Network request timed out. Check your connection or network policies.');
      }
      throw e;
    } finally {
      clearTimeout(t);
    }
  };
}

function makeThenableResult<T>(value: T) {
  // A very small "query builder" stub:
  // - allows arbitrary chaining: .select().eq().order().single()...
  // - is awaitable via a custom `then`, returning the provided value.
  // - prevents "Cannot read properties of null" crashes when Supabase is misconfigured.
  const fn: any = () => proxy;
  const proxy: any = new Proxy(fn, {
    get(_target, prop) {
      if (prop === 'then') return (resolve: any) => resolve(value);
      if (prop === 'catch') return () => proxy;
      if (prop === 'finally') return () => proxy;
      return proxy;
    },
    apply() {
      return proxy;
    },
  });
  return proxy as any;
}

function createSupabaseStub(message: string) {
  const err = { message };
  const queryResult = { data: null, error: err };
  const authSessionResult = { data: { session: null }, error: err };
  return {
    auth: {
      getSession: async () => authSessionResult,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: async () => ({ error: err }),
      updateUser: async () => ({ error: err }),
    },
    from: () => makeThenableResult(queryResult),
    rpc: () => makeThenableResult(queryResult),
  } as any;
}

export function getSupabaseEnvError(): string | null {
  if (_initError !== undefined) return _initError;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    _initError =
      'Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel.';
    return _initError;
  }
  _initError = null;
  return null;
}

export function getSupabaseClient(): SupabaseClient | null {
  if (_client !== undefined) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    // Do not throw at import-time. Let the app render an error state.
    _client = null;
    // Ensure we cache a helpful error message for UI/console.
    void getSupabaseEnvError();
    try {
      // eslint-disable-next-line no-console
      console.error('SUPABASE_ENV_MISSING', {
        hasUrl: Boolean(url),
        hasAnonKey: Boolean(anon),
      });
    } catch {
      // ignore
    }
    return null;
  }

  try {
    _client = createClient(url, anon, {
      global: {
        // Prevent infinite loading when networks block Supabase (corporate WiFi, VPN, etc.).
        fetch: fetchWithTimeout(12000),
      },
    });
    _initError = null;
    return _client;
  } catch (e: any) {
    _client = null;
    _initError = String(e?.message ?? e ?? 'Supabase client init failed.');
    try {
      // eslint-disable-next-line no-console
      console.error('SUPABASE_INIT_FAILED', _initError);
    } catch {
      // ignore
    }
    return null;
  }
}

// Backwards-compatible export for existing call sites.
// This will NEVER throw at import time; if env vars are missing, it's a safe stub.
export const supabase: SupabaseClient = (getSupabaseClient() ??
  createSupabaseStub(getSupabaseEnvError() ?? 'Supabase is not configured.')) as any;
