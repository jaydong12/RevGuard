"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthCard } from '../../../components/AuthCard';
import { supabase } from '../../../utils/supabaseClient';
import { loadStripe } from '@stripe/stripe-js';
import { useAppData } from '../../../components/AppDataProvider';

export default function OnboardingBankingPage() {
  const router = useRouter();
  const { businessId } = useAppData();
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const uid = data.session?.user?.id ?? null;
        if (!uid) {
          router.replace('/check-email?next=/onboarding/banking');
          return;
        }

        await supabase
          .from('profiles')
          .upsert({ id: uid, onboarding_step: 'banking', onboarding_complete: false } as any, { onConflict: 'id' });
      } catch (e: any) {
        setError(String(e?.message ?? 'Failed to load.'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  async function finalizeOnboarding() {
    setSaving(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id ?? null;
      if (!uid) throw new Error('Please sign in again.');
      if (!businessId) throw new Error('No business found for this account.');

      // Verify required steps are complete.
      const { data: biz, error: bizErr } = await supabase
        .from('business')
        .select('id,is_setup_complete')
        .eq('id', businessId)
        .maybeSingle();
      if (bizErr) throw bizErr;
      if (!(biz as any)?.is_setup_complete) throw new Error('Business setup is incomplete. Please complete Business info.');

      const { data: prof, error: profErr } = await supabase
        .from('profiles')
        .select('id,full_name')
        .eq('id', uid)
        .maybeSingle();
      if (profErr) throw profErr;
      const name = String((prof as any)?.full_name ?? '').trim();
      if (!name) throw new Error('Profile setup is incomplete. Please complete Profile info.');

      const upd = await supabase
        .from('profiles')
        .update({ onboarding_complete: true, onboarding_step: 'done' } as any)
        .eq('id', uid);
      if (upd.error) throw upd.error;

      router.replace('/dashboard');
    } catch (e: any) {
      setError(String(e?.message ?? 'Failed to finish onboarding.'));
    } finally {
      setSaving(false);
    }
  }

  async function connectBank() {
    if (!businessId) {
      setError('No business found for this account.');
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch('/api/stripe/fc/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(String(json?.error ?? 'Failed to start bank connect.'));

      const clientSecret = String(json?.client_secret ?? '');
      const sessionId = String(json?.session_id ?? '');
      if (!clientSecret || !sessionId) throw new Error('Missing Stripe client_secret/session_id.');

      const pk = String((process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY as any) ?? '');
      if (!pk) throw new Error('Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.');
      const stripe = await loadStripe(pk);
      if (!stripe) throw new Error('Stripe.js failed to load.');

      const collect = (stripe as any).collectFinancialConnectionsAccounts;
      if (typeof collect !== 'function') throw new Error('Stripe.js Financial Connections is not available.');

      const collected = await collect.call(stripe, { clientSecret });
      if (collected?.error) throw new Error(String(collected.error?.message ?? 'Bank linking failed.'));

      const done = await fetch('/api/stripe/fc/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, session_id: sessionId }),
      });
      const doneJson = (await done.json().catch(() => null)) as any;
      if (!done.ok) throw new Error(String(doneJson?.error ?? 'Failed to complete bank connection.'));

      await finalizeOnboarding();
    } catch (e: any) {
      setError(String(e?.message ?? 'Bank connect failed.'));
    } finally {
      setConnecting(false);
    }
  }

  return (
    <main>
      <AuthCard
        title="Banking (optional)"
        subtitle="Connect your bank to auto-import transactions. You can skip for now."
        footer={<div className="text-[11px] text-slate-400">You can connect later in Settings → Banking.</div>}
      >
        {error ? (
          <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => void connectBank()}
            disabled={loading || connecting || saving}
            className="w-full rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {connecting ? 'Connecting…' : 'Connect Bank'}
          </button>

          <button
            type="button"
            onClick={() => void finalizeOnboarding()}
            disabled={loading || connecting || saving}
            className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-900/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Finishing…' : 'Skip for now'}
          </button>
        </div>
      </AuthCard>
    </main>
  );
}


