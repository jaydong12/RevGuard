'use client';

import React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AuthCard } from '../../components/AuthCard';

export default function CheckEmailPage() {
  const params = useSearchParams();
  const next = String(params.get('next') ?? '/dashboard').trim() || '/dashboard';

  return (
    <main>
      <AuthCard
        title="Check your email"
        subtitle="Confirm your email to finish creating your account."
        compact
        footer={
          <div className="text-[11px] text-slate-400">
            After you confirm, you’ll be sent back to continue setup.
          </div>
        }
      >
        <div className="space-y-4">
          <div className="text-sm text-slate-300 leading-relaxed">
            We sent you a confirmation link. Open it to complete signup.
          </div>

          <div className="flex flex-col gap-2">
            <Link
              href={`/login?next=${encodeURIComponent(next)}`}
              className="w-full text-center rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
            >
              Go to log in
            </Link>
            <Link
              href="/"
              className="w-full text-center rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-900/60"
            >
              Back to home
            </Link>
          </div>
        </div>
      </AuthCard>
    </main>
  );
}


