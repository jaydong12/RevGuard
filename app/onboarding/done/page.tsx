"use client";

import React from 'react';
import Link from 'next/link';
import { AuthCard } from '../../../components/AuthCard';
import { CheckCircle2 } from 'lucide-react';
import { OnboardingProgress } from '../../../components/onboarding/OnboardingProgress';

export default function OnboardingDonePage() {
  return (
    <main>
      <AuthCard
        title="Your financial command center is ready."
        subtitle="You’re all set. You can connect a bank anytime in Settings."
        footer={<div className="text-[11px] text-slate-400">Tip: Settings → Banking lets you sync any time.</div>}
      >
        <OnboardingProgress step="done" />

        <div className="flex flex-col items-center text-center gap-3 py-2">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-emerald-500/20 blur-2xl" />
            <CheckCircle2 className="relative h-14 w-14 text-emerald-300" />
          </div>

          <div className="text-sm text-slate-300 max-w-sm">
            Transactions will start organizing automatically once you connect your bank. You can review anything flagged
            as needs review.
          </div>

          <Link
            href="/dashboard"
            className="mt-2 w-full text-center rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
          >
            Go to Dashboard
          </Link>
        </div>
      </AuthCard>
    </main>
  );
}


