"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthCard } from '../../../components/AuthCard';
import { supabase } from '../../../utils/supabaseClient';
import { OnboardingProgress } from '../../../components/onboarding/OnboardingProgress';

export default function OnboardingProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const uid = data.session?.user?.id ?? null;
        if (!uid) {
          router.replace('/check-email?next=/onboarding/profile');
          return;
        }

        const { data: prof, error: profErr } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
        if (!alive) return;
        if (profErr) throw profErr;
        setFullName(String((prof as any)?.full_name ?? ''));

        // Keep onboarding step stable.
        await supabase
          .from('profiles')
          .upsert({ id: uid, onboarding_step: 'profile', onboarding_complete: false } as any, { onConflict: 'id' });
      } catch (e: any) {
        setError(String(e?.message ?? 'Failed to load profile.'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  async function saveAndContinue() {
    const name = fullName.trim();
    if (!name) {
      setError('Your name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id ?? null;
      if (!uid) throw new Error('Please sign in again.');

      const up = await supabase
        .from('profiles')
        .upsert(
          { id: uid, full_name: name, onboarding_step: 'banking', onboarding_complete: false } as any,
          { onConflict: 'id' }
        );
      if (up.error) throw up.error;

      router.replace('/onboarding/banking');
    } catch (e: any) {
      setError(String(e?.message ?? 'Failed to save.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main>
      <AuthCard
        title="Let’s set up your financial command center."
        subtitle="This takes about 60 seconds. You can edit this anytime in Settings."
      >
        <OnboardingProgress step="profile" />
        {error ? (
          <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="block text-[11px] text-slate-400">Full name *</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={loading || saving}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="Jane Doe"
              autoComplete="name"
            />
          </div>

          <button
            type="button"
            onClick={() => void saveAndContinue()}
            disabled={loading || saving}
            className="w-full rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Next →'}
          </button>
        </div>
      </AuthCard>
    </main>
  );
}


