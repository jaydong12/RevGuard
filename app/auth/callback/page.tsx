'use client';

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

export default function AuthCallbackPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/dashboard';

  const [message, setMessage] = useState('Finishing sign-in…');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Supabase OAuth / PKCE flow sends ?code=...
        const code = params.get('code');
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }

        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        setAuthCookie(token);

        if (!alive) return;
        setMessage('Redirecting…');
        router.replace(next || '/dashboard');
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error('AUTH_CALLBACK_ERROR', e);
        if (!alive) return;
        setMessage(e?.message ? `Sign-in failed: ${e.message}` : 'Sign-in failed.');
        // Give them a way out.
        window.setTimeout(() => {
          router.replace('/dashboard');
        }, 800);
      }
    })();
    return () => {
      alive = false;
    };
  }, [params, router, next]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950/60 p-6 text-sm text-slate-200">
        {message}
      </div>
    </main>
  );
}


