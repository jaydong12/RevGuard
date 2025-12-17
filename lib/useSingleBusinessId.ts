'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabaseClient';

type Result = {
  businessId: string | null;
  loading: boolean;
  error: string | null;
};

export function useSingleBusinessId(): Result {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const { data } = await supabase.auth.getSession();
        const session = data.session;
        if (!session) {
          if (!mounted) return;
          setBusinessId(null);
          setLoading(false);
          return;
        }

        const userId = session.user.id;
        const baseName = 'My Business';

        // Strict: owner-scoped business only. If owner_id isn't migrated yet,
        // we fail closed to prevent cross-account data leakage.
        const res = await supabase
          .from('business')
          .select('id, created_at, owner_id')
          .eq('owner_id', userId)
          .order('created_at', { ascending: true });

        if (res.error) throw res.error;

        const rows = (res.data as any[]) ?? [];
        if (rows.length >= 1) {
          if (!mounted) return;
          setBusinessId(String(rows[0].id));
          setLoading(false);
          return;
        }

        // Create the single business if none exist yet.
        const ins = await supabase
          .from('business')
          .insert({ name: baseName, owner_id: userId } as any)
          .select('id')
          .single();

        if (ins.error) throw ins.error;

        if (!mounted) return;
        setBusinessId(String((ins.data as any)?.id ?? null));
        setLoading(false);
      } catch (e: any) {
        if (!mounted) return;
        const msg = String(e?.message ?? e ?? '');

        // Common setup issues: owner_id not migrated yet or RLS/policies not applied.
        if (
          msg.toLowerCase().includes('owner_id') &&
          (msg.toLowerCase().includes('does not exist') ||
            msg.toLowerCase().includes('column'))
        ) {
          setError(
            'Database migration required: add public.business.owner_id (run `supabase/business_add_owner_id.sql`), then reload.'
          );
        } else if (
          msg.toLowerCase().includes('row level security') ||
          msg.toLowerCase().includes('permission denied') ||
          msg.toLowerCase().includes('not authorized')
        ) {
          setError(
            'Permission denied loading your business. Enable RLS policies so auth.uid() can read/insert their business.'
          );
        } else {
          setError(msg || 'Failed to load business.');
        }

        // Avoid noisy console errors for expected setup issues; keep logs in dev.
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.warn('USE_SINGLE_BUSINESS_ERROR', e);
        }
        setBusinessId(null);
        setLoading(false);
      }
    }

    void run();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void run();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { businessId, loading, error };
}


