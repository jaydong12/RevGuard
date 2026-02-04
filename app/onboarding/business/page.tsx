"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthCard } from '../../../components/AuthCard';
import { supabase } from '../../../utils/supabaseClient';
import { getOrCreateBusinessId } from '../../../lib/getOrCreateBusinessId';

function digitsOnly(s: string) {
  return (s || '').replace(/\D/g, '');
}

function formatPhoneDisplay(input: string) {
  const d = digitsOnly(input).slice(0, 10);
  const len = d.length;
  if (len === 0) return '';
  if (len < 4) return `(${d}`;
  if (len < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function normalizePhoneForDb(input: string) {
  return digitsOnly(input).slice(0, 10);
}

function normalizeEmailForDb(input: string) {
  return (input || '').trim().toLowerCase();
}

function isValidEmail(input: string) {
  const v = normalizeEmailForDb(input);
  if (!v) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export default function OnboardingBusinessPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [bizId, setBizId] = useState<string | null>(null);
  const [bizName, setBizName] = useState('');
  const [bizEmail, setBizEmail] = useState('');
  const [bizPhone, setBizPhone] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const uid = data.session?.user?.id ?? null;
        if (!uid) {
          router.replace('/check-email?next=/onboarding/business');
          return;
        }

        const ensuredBizId = await getOrCreateBusinessId(supabase);
        if (!alive) return;
        setBizId(ensuredBizId);

        const { data: biz, error: bizErr } = await supabase
          .from('business')
          .select('id,name,email,phone,is_setup_complete')
          .eq('id', ensuredBizId)
          .maybeSingle();
        if (!alive) return;
        if (bizErr) throw bizErr;

        const b: any = biz ?? null;
        setBizName(String(b?.name ?? ''));
        setBizEmail(String(b?.email ?? ''));
        setBizPhone(formatPhoneDisplay(String(b?.phone ?? '')));

        // Ensure profile row exists; keep step stable.
        await supabase
          .from('profiles')
          .upsert({ id: uid, onboarding_step: 'business', onboarding_complete: false } as any, { onConflict: 'id' });
      } catch (e: any) {
        setError(String(e?.message ?? 'Failed to load business info.'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  async function saveAndContinue() {
    if (!bizId) return;
    const name = bizName.trim();
    const email = normalizeEmailForDb(bizEmail);
    const phone = normalizePhoneForDb(bizPhone);

    if (!name) {
      setError('Business name is required.');
      return;
    }
    if (!email && !phone) {
      setError('Add at least an email or phone number.');
      return;
    }
    if (email && !isValidEmail(email)) {
      setError('Business email looks invalid.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id ?? null;
      if (!uid) throw new Error('Please sign in again.');

      const upd = await supabase
        .from('business')
        .update({
          name,
          email: email || null,
          phone: phone || null,
          is_setup_complete: true,
        } as any)
        .eq('id', bizId);
      if (upd.error) throw upd.error;

      const prof = await supabase
        .from('profiles')
        .upsert({ id: uid, onboarding_step: 'profile', onboarding_complete: false } as any, { onConflict: 'id' });
      if (prof.error) throw prof.error;

      router.replace('/onboarding/profile');
    } catch (e: any) {
      setError(String(e?.message ?? 'Failed to save.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main>
      <AuthCard title="Business info" subtitle="Tell us about your business. You can edit this later in Settings.">
        {error ? (
          <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="block text-[11px] text-slate-400">Business name *</label>
            <input
              value={bizName}
              onChange={(e) => setBizName(e.target.value)}
              disabled={loading || saving}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="My Business"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] text-slate-400">Email</label>
            <input
              value={bizEmail}
              onChange={(e) => setBizEmail(e.target.value)}
              disabled={loading || saving}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="billing@mybusiness.com"
              inputMode="email"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] text-slate-400">Phone</label>
            <input
              value={bizPhone}
              onChange={(e) => setBizPhone(formatPhoneDisplay(e.target.value))}
              disabled={loading || saving}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="(555) 555-5555"
              inputMode="tel"
            />
          </div>

          <button
            type="button"
            onClick={() => void saveAndContinue()}
            disabled={loading || saving}
            className="w-full rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Continue'}
          </button>
        </div>
      </AuthCard>
    </main>
  );
}


