'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthCard } from '../../components/AuthCard';
import { supabase } from '../../utils/supabaseClient';

export default function OnboardingPage() {
  const router = useRouter();
  const params = useSearchParams();
  const from = String(params.get('from') ?? '').trim().toLowerCase();
  const sessionId = String(params.get('session_id') ?? '').trim();

  React.useEffect(() => {
    let alive = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!alive) return;
        const uid = data.session?.user?.id ?? null;
        if (!uid) {
          router.replace('/check-email?next=/onboarding');
        }
      })
      .catch(() => {
        if (!alive) return;
        router.replace('/check-email?next=/onboarding');
      });
    return () => {
      alive = false;
    };
  }, [router]);

  return (
    <main>
      <AuthCard
        title="Finish setup"
        subtitle="A few quick steps to tailor your workspace."
        footer={
          <div className="text-[11px] text-slate-400">
            {from === 'stripe'
              ? 'Payment received. Continue setup to access your dashboard.'
              : 'Continue setup to access your dashboard.'}
          </div>
        }
      >
        <div className="space-y-4">
          {from === 'stripe' ? (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              Your subscription is being activated.
              {sessionId ? (
                <div className="mt-1 text-[11px] text-emerald-200/80">
                  Session: <span className="text-emerald-100">{sessionId}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="text-sm text-slate-300 leading-relaxed">
            Your next steps will appear here.
          </div>

          <Link
            href="/dashboard"
            className="w-full text-center rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
          >
            Continue
          </Link>
        </div>
      </AuthCard>
    </main>
  );
}


