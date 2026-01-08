'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../utils/supabaseClient';
import type { PlanId } from '../lib/plans';

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

async function ensureSingleBusiness(userId: string, email?: string | null) {
  // Strict: owner-scoped businesses only (fail closed if owner_id isn't migrated).
  const baseName = email ? `${email.split('@')[0]}'s Business` : 'My Business';

  const res = await supabase
    .from('business')
    .select('id,name,created_at,owner_id')
    .eq('owner_id', userId)
    .order('created_at', { ascending: true });

  if (res.error) throw res.error;

  const rows = (res.data as any[]) ?? [];
  if (rows.length >= 1) {
    // Use the first business.
    return String(rows[0].id);
  }

  // Create one business for the user.
  const insertPayload: any = { name: baseName };
  insertPayload.owner_id = userId;

  const ins = await supabase.from('business').insert(insertPayload).select('id').single();
  if (ins.error) throw ins.error;
  return String((ins.data as any)?.id);
}

export function StartPlanButton({
  plan,
  className,
  label,
  disabled,
}: {
  plan: Exclude<PlanId, 'none'>;
  className?: string;
  label?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (disabled) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session) {
        router.push('/login?redirect=/pricing');
        return;
      }

      const userId = session.user.id;
      await ensureSingleBusiness(userId, session.user.email);

      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ planId: plan }),
      });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        throw new Error(body.error || 'Failed to start checkout.');
      }

      window.location.href = body.url;
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('START_PLAN_ERROR', plan, e);
      setError(String(e?.message ?? 'Could not start checkout.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onClick}
        disabled={Boolean(disabled) || loading}
        className={classNames(
          className,
          (Boolean(disabled) || loading) && 'opacity-70 cursor-not-allowed'
        )}
      >
        {loading ? 'Starting…' : label || 'Start'}
      </button>
      {error && <div className="text-sm text-rose-300">{error}</div>}
    </div>
  );
}


