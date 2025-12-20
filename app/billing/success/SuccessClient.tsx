'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../utils/supabaseClient';

function setAuthCookie(token: string | null) {
  try {
    if (!token) {
      document.cookie = `rg_at=; Path=/; Max-Age=0; SameSite=Lax`;
      return;
    }
    document.cookie = `rg_at=${encodeURIComponent(token)}; Path=/; Max-Age=604800; SameSite=Lax`;
  } catch {
    // ignore
  }
}

const ADMIN_EMAILS = ['jaydongant@gmail.com', 'shannon_g75@yahoo.com'].map((e) =>
  e.toLowerCase()
);

export default function BillingSuccessClient() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get('session_id');

  const [status, setStatus] = useState<'checking' | 'active' | 'inactive' | 'error'>('checking');
  const [detail, setDetail] = useState<string>('Finalizing your subscription…');

  useEffect(() => {
    let alive = true;

    async function run() {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data.session ?? null;
        if (!session) {
          if (!alive) return;
          setStatus('inactive');
          setDetail('Please log in to finish activating your subscription.');
          router.replace('/login?redirect=/pricing');
          return;
        }

        setAuthCookie(session.access_token ?? null);
        const userId = session.user.id;
        const userEmail = String(session.user.email ?? '').trim().toLowerCase();
        if (userEmail && ADMIN_EMAILS.includes(userEmail)) {
          if (!alive) return;
          setStatus('active');
          setDetail('Admin access enabled. Redirecting to your dashboard…');
          router.refresh();
          router.replace('/dashboard');
          return;
        }

        const started = Date.now();
        const timeoutMs = 45_000;

        while (alive && Date.now() - started < timeoutMs) {
          const first = await supabase
            .from('business')
            .select('id, subscription_status')
            .eq('owner_id', userId)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();

          const sub = String((first.data as any)?.subscription_status ?? 'inactive').toLowerCase();
          if (sub === 'active') {
            if (!alive) return;
            setStatus('active');
            setDetail('Subscription active. Redirecting to your dashboard…');
            // Ensure any server components revalidate if needed.
            router.refresh();
            router.replace('/dashboard');
            return;
          }

          if (!alive) return;
          setStatus('checking');
          setDetail('Processing payment… (this can take a few seconds)');
          await new Promise((r) => setTimeout(r, 2000));
        }

        if (!alive) return;
        setStatus('inactive');
        setDetail('Payment received, but activation is still processing. Go to Pricing to retry.');
        router.replace('/pricing');
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error('BILLING_SUCCESS_ERROR', e);
        if (!alive) return;
        setStatus('error');
        setDetail(e?.message ?? 'Could not verify subscription status.');
      }
    }

    void run();

    return () => {
      alive = false;
    };
  }, [router]);

  return (
    <main className="max-w-2xl mx-auto">
      <div className="rounded-3xl border border-slate-800/80 bg-slate-950/45 backdrop-blur-sm shadow-[0_30px_90px_rgba(0,0,0,0.35)] overflow-hidden">
        <div className="p-7 md:p-10">
          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
            Billing
          </div>
          <h1 className="mt-2 text-2xl md:text-3xl font-bold tracking-tight text-slate-50">
            You’re all set
          </h1>
          <p className="mt-2 text-sm md:text-base text-slate-300 leading-relaxed">
            {detail}
          </p>
          <div className="mt-4 text-[11px] text-slate-500">
            Status:{' '}
            <span className="text-slate-200">
              {status === 'checking'
                ? 'Checking…'
                : status === 'active'
                ? 'Active'
                : status === 'inactive'
                ? 'Inactive'
                : 'Error'}
            </span>
          </div>
          {sessionId ? (
            <div className="mt-4 text-[11px] text-slate-500">
              Session: <span className="text-slate-300">{sessionId}</span>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}


