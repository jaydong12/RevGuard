"use client";

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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

function parseHashParams() {
  const raw = (typeof window !== 'undefined' ? window.location.hash : '') || '';
  const h = raw.startsWith('#') ? raw.slice(1) : raw;
  const sp = new URLSearchParams(h);
  return {
    access_token: sp.get('access_token'),
    refresh_token: sp.get('refresh_token'),
    type: sp.get('type'),
  };
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next'); // optional
  const isAdminInvite = params.get('admin_invite') === '1';
  const adminBusinessId = params.get('business_id');

  const [message, setMessage] = useState('Finishing sign-in…');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const code = params.get('code');
        const hash = parseHashParams();

        // eslint-disable-next-line no-console
        console.log('AUTH_CALLBACK_START', {
          hasCode: Boolean(code),
          hasHashTokens: Boolean(hash.access_token && hash.refresh_token),
          hashType: hash.type,
          next,
          isAdminInvite,
          hasAdminBusinessId: Boolean(adminBusinessId),
        });

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (hash.access_token && hash.refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token: hash.access_token,
            refresh_token: hash.refresh_token,
          });
          if (error) throw error;
        }

        const { data } = await supabase.auth.getSession();
        const session = data.session ?? null;
        const token = session?.access_token ?? null;
        setAuthCookie(token);

        // eslint-disable-next-line no-console
        console.log('AUTH_CALLBACK_SESSION', { hasSession: Boolean(token) });

        if (!alive) return;

        if (!session?.user?.id) {
          setMessage('Sign-in failed. Redirecting…');
          router.replace('/login');
          return;
        }

        // Finalize admin invite membership best-effort.
        if (token && isAdminInvite && adminBusinessId) {
          try {
            setMessage('Setting up your admin access…');
            await fetch('/api/admin/accept-admin-invite', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
              body: JSON.stringify({ businessId: adminBusinessId }),
            });
          } catch {
            // ignore
          }
        }

        // Special-case: password recovery flow should always go to /reset-password.
        if (next === '/reset-password' || hash.type === 'recovery') {
          // eslint-disable-next-line no-console
          console.log('AUTH_CALLBACK_REDIRECT', { reason: 'reset_password', to: '/reset-password' });
          router.replace('/reset-password');
          return;
        }

        // Decide onboarding vs dashboard (no redirect=/login params).
        const { data: prof, error: profErr } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .maybeSingle();
        if (profErr) {
          // eslint-disable-next-line no-console
          console.warn('AUTH_CALLBACK_PROFILE_ERROR', profErr);
        }
        const profile: any = prof ?? null;

        const onboardedFlag =
          profile?.onboarded ??
          profile?.onboarding_complete ??
          profile?.onboarding_completed ??
          null;
        const isOnboarded =
          typeof onboardedFlag === 'boolean' ? onboardedFlag : Boolean(profile?.business_id);

        const dest = isOnboarded ? '/dashboard' : '/onboarding';
        // eslint-disable-next-line no-console
        console.log('AUTH_CALLBACK_REDIRECT', { reason: 'post_auth', onboarded: isOnboarded, to: dest });
        setMessage('Redirecting…');
        router.replace(dest);
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error('AUTH_CALLBACK_ERROR', e);
        if (!alive) return;
        setMessage('Sign-in failed. Redirecting…');
        router.replace('/login');
      }
    })();

    return () => {
      alive = false;
    };
  }, [params, router, next, isAdminInvite, adminBusinessId]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950/60 p-6 text-sm text-slate-200">
        {message}
      </div>
    </main>
  );
}
