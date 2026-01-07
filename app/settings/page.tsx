'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../utils/supabaseClient';
import { getOrCreateBusinessId } from '../../lib/getOrCreateBusinessId';
import { Building2, Globe, Image as ImageIcon, Mail, MapPin, Phone, CreditCard, Shield, User } from 'lucide-react';

function safeConsoleError(err: any) {
  try {
    // eslint-disable-next-line no-console
    console.error(err);
  } catch {
    // ignore (some environments can throw on console access)
  }
}

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

function formatZipDisplay(input: string) {
  const d = digitsOnly(input).slice(0, 9);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

function normalizeZipForDb(input: string) {
  return digitsOnly(input).slice(0, 9);
}

function normalizeStateForDb(input: string) {
  const v = (input || '').replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase();
  return v;
}

function normalizeEmailForDb(input: string) {
  return (input || '').trim().toLowerCase();
}

function isValidEmail(input: string) {
  const v = normalizeEmailForDb(input);
  if (!v) return false;
  // pragmatic validation
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function normalizeWebsiteForDb(input: string) {
  let v = (input || '').trim().toLowerCase();
  if (!v) return '';
  // If user typed a domain, store a usable URL.
  if (!/^https?:\/\//.test(v)) v = `https://${v}`;
  return v;
}

function splitLegacyAddress(addr: string) {
  const parts = String(addr || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return {
    line1: parts[0] ?? '',
    line2: parts.slice(1).join(' ') ?? '',
  };
}

type ProfileRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  updated_at: string;
};

type ToastType = 'success' | 'error' | 'info';
type ToastState = { type: ToastType; message: string } | null;

type SettingsTab = 'business' | 'profile' | 'security' | 'billing';

function normalizeTab(raw: string | null): SettingsTab {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'business' || v === 'profile' || v === 'security' || v === 'billing') {
    return v;
  }
  return 'business';
}

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = useMemo<SettingsTab>(() => normalizeTab(searchParams.get('tab')), [searchParams]);
  const [sessionEmail, setSessionEmail] = useState<string>('');
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // Toast
  const [toast, setToast] = useState<ToastState>(null);

  // Profile state
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileExists, setProfileExists] = useState<boolean>(false);

  // Business Profile state
  const [bizLoading, setBizLoading] = useState(true);
  const [bizSaving, setBizSaving] = useState(false);
  const [bizError, setBizError] = useState<string | null>(null);
  const [bizId, setBizId] = useState<string | null>(null);

  // Business Profile form state
  const [bizName, setBizName] = useState('');
  const [bizEmail, setBizEmail] = useState('');
  const [bizPhone, setBizPhone] = useState('');
  const [bizWebsite, setBizWebsite] = useState('');
  const [bizLogoUrl, setBizLogoUrl] = useState('');
  const [bizAddress1, setBizAddress1] = useState('');
  const [bizAddress2, setBizAddress2] = useState('');
  const [bizCity, setBizCity] = useState('');
  const [bizState, setBizState] = useState('');
  const [bizZip, setBizZip] = useState('');
  const [bizEmailInvalid, setBizEmailInvalid] = useState(false);

  // Profile form state
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');

  // Password change state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null); // keep inline for field-level context

  // Danger Zone state
  const [deleteAcknowledge, setDeleteAcknowledge] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null); // keep inline for clarity

  function showToast(type: ToastType, message: string) {
    setToast({ type, message });
    window.clearTimeout((showToast as any)._t);
    (showToast as any)._t = window.setTimeout(() => setToast(null), 2600);
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const email = data.session?.user?.email ?? '';
        const userId = data.session?.user?.id ?? null;
        if (!mounted) return;
        setSessionEmail(email);
        setSessionUserId(userId);

        if (!userId) {
          setProfileLoading(false);
          setBizLoading(false);
          return;
        }

        // Load business profile (get-or-create + fetch full row)
        setBizLoading(true);
        setBizError(null);
        try {
          const ensuredBizId = await getOrCreateBusinessId(supabase);
          if (!mounted) return;
          setBizId(ensuredBizId);

          const { data: bizRow, error: bizErr } = await supabase
            .from('business')
            .select('*')
            .eq('id', ensuredBizId)
            .maybeSingle();

          if (!mounted) return;

          if (bizErr) {
            safeConsoleError(bizErr);
            setBizError(bizErr.message || 'Could not load business profile.');
          } else {
            const b: any = bizRow ?? null;
            setBizName(b?.name ?? '');
            setBizEmail((b?.email ?? '').toString());
            setBizEmailInvalid(Boolean(b?.email) && !isValidEmail(String(b?.email)));
            setBizPhone(formatPhoneDisplay(b?.phone ?? ''));
            setBizWebsite((b?.website ?? '').toString());
            setBizLogoUrl(b?.logo_url ?? '');
            const legacy = b?.address ? splitLegacyAddress(String(b.address)) : { line1: '', line2: '' };
            setBizAddress1(b?.address1 ?? b?.address_line1 ?? legacy.line1 ?? '');
            setBizAddress2(b?.address2 ?? b?.address_line2 ?? legacy.line2 ?? '');
            setBizCity(b?.city ?? '');
            setBizState(String(b?.state ?? '').toUpperCase());
            setBizZip(formatZipDisplay(b?.zip ?? ''));
          }
        } catch (e: any) {
          if (!mounted) return;
          safeConsoleError(e);
          setBizError(e?.message || 'Could not load business profile.');
        } finally {
          if (mounted) setBizLoading(false);
        }

        setProfileLoading(true);
        setProfileError(null);
        const { data: row, error } = await supabase
          .from('profiles')
          // Use '*' so older DBs missing new columns (e.g. full_name) don't throw.
          .select('*')
          .eq('id', userId)
          .maybeSingle();

        if (!mounted) return;

        if (error) {
          const msg = error.message || 'Could not load profile.';
          if (msg.toLowerCase().includes('relation') && msg.toLowerCase().includes('profiles')) {
            setProfileError(
              'Profiles table not found. Run the SQL in supabase/profiles_and_cascade.sql and try again.'
            );
          } else {
            setProfileError(msg);
          }
          setProfileLoading(false);
          return;
        }

        const profile = (row as ProfileRow | null) ?? null;
        setProfileExists(Boolean(profile?.id));
        setFullName(profile?.full_name ?? '');
        setPhone(profile?.phone ?? '');
        setCity(profile?.city ?? '');
        setCountry(profile?.country ?? '');
        setProfileLoading(false);
      } catch {
        if (!mounted) return;
        setProfileLoading(false);
        setBizLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const avatarInitials = useMemo(() => {
    const source = (fullName || sessionEmail || 'User').trim();
    if (!source) return 'U';

    // Prefer initials from a name like "Jane Doe".
    if (fullName.trim()) {
      const parts = fullName
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const first = parts[0]?.[0] ?? 'U';
      const second = (parts[1]?.[0] ?? parts[0]?.[1] ?? '') || '';
      return `${first}${second}`.toUpperCase();
    }

    // Fallback: first 2 chars of email prefix.
    const prefix = source.split('@')[0] || source;
    return prefix.slice(0, 2).toUpperCase();
  }, [fullName, sessionEmail]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await supabase.auth.signOut();
      try {
        document.cookie = `rg_at=; Path=/; Max-Age=0; SameSite=Lax`;
      } catch {
        // ignore
      }
      router.push('/login');
    } finally {
      setSigningOut(false);
    }
  }

  async function handleSaveProfile() {
    setProfileError(null);

    if (!sessionUserId) {
      showToast('error', 'Please log in to save your profile.');
      return;
    }

    setProfileSaving(true);
    try {
      // Update-only flow to avoid INSERTs (some RLS setups block inserts).
      const { data: existing, error: existsErr } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', sessionUserId)
        .maybeSingle();

      if (existsErr) {
        const msg = existsErr.message || 'Could not check profile.';
        setProfileError(msg);
        showToast('error', msg);
        return;
      }

      if (!existing?.id) {
        setProfileExists(false);
        showToast('info', 'Profile will be created on first login');
        return;
      }

      const now = new Date().toISOString();
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim() || null,
          phone: phone.trim() || null,
          city: city.trim() || null,
          country: country.trim() || null,
          updated_at: now,
        })
        .eq('id', sessionUserId);

      if (error) {
        const raw = error.message || 'Could not save profile.';
        const msg =
          raw.toLowerCase().includes('full_name') &&
          (raw.toLowerCase().includes('does not exist') ||
            raw.toLowerCase().includes('column'))
            ? 'Profile columns are missing in the database. Run the SQL to add profiles.full_name and profiles.updated_at, then retry.'
            : raw;
        setProfileError(msg);
        showToast('error', msg);
        return;
      }

      setProfileExists(true);
      showToast('success', 'Profile saved.');
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleSaveBusinessProfile() {
    setBizError(null);

    if (!sessionUserId) {
      showToast('error', 'Please sign in to update your business profile.');
      return;
    }

    if (!bizName.trim()) {
      const msg = 'Business name is required.';
      setBizError(msg);
      showToast('error', msg);
      return;
    }

    const normalizedEmail = normalizeEmailForDb(bizEmail);
    const normalizedPhone = normalizePhoneForDb(bizPhone);
    const normalizedWebsite = normalizeWebsiteForDb(bizWebsite);
    const normalizedZip = normalizeZipForDb(bizZip);
    const normalizedState = normalizeStateForDb(bizState);

    if (normalizedEmail && !isValidEmail(normalizedEmail)) {
      const msg = 'Please enter a valid email address.';
      setBizEmailInvalid(true);
      setBizError(msg);
      showToast('error', msg);
      return;
    }

    if (!normalizedEmail && !normalizedPhone) {
      const msg = 'Add at least an email or phone number.';
      setBizError(msg);
      showToast('error', msg);
      return;
    }

    setBizSaving(true);
    try {
      const ensuredBizId = bizId ?? (await getOrCreateBusinessId(supabase));
      setBizId(ensuredBizId);

      const payload: any = {
        owner_id: sessionUserId,
        name: bizName.trim(),
        // store normalized (no formatting)
        email: normalizedEmail || null,
        phone: normalizedPhone || null,
        website: normalizedWebsite || null,
        logo_url: bizLogoUrl.trim() || null,
        address1: bizAddress1.trim() || null,
        address2: bizAddress2.trim() || null,
        city: bizCity.trim() || null,
        state: normalizedState || null,
        zip: normalizedZip || null,
      };

      // Some deployments use legacy column names (address_line1/address_line2 or a single address).
      // Try modern columns first, then fall back based on the *raw* Supabase error object.
      const attemptUpdate = async (p: any) => {
        const { error } = await supabase
          .from('business')
          .update(p)
          .eq('id', ensuredBizId)
          .eq('owner_id', sessionUserId);

        if (error) {
          try {
            // eslint-disable-next-line no-console
            console.error('SUPABASE ERROR', error);
          } catch {
            // ignore
          }
          throw error;
        }
      };

      try {
        await attemptUpdate(payload);
      } catch (e1: any) {
        const msg1 = String(e1?.message ?? e1 ?? '').toLowerCase();
        const missingAddress1 =
          msg1.includes('address1') && (msg1.includes('does not exist') || msg1.includes('schema cache'));

        if (!missingAddress1) throw e1;

        // Try legacy address_line1/address_line2
        try {
          const payload2 = { ...payload };
          delete payload2.address1;
          delete payload2.address2;
          payload2.address_line1 = bizAddress1.trim() || null;
          payload2.address_line2 = bizAddress2.trim() || null;
          await attemptUpdate(payload2);
        } catch (e2: any) {
          const msg2 = String(e2?.message ?? e2 ?? '').toLowerCase();
          const missingAddressLine =
            msg2.includes('address_line1') &&
            (msg2.includes('does not exist') || msg2.includes('schema cache'));

          if (!missingAddressLine) throw e2;

          // Final fallback: single `address` column with newlines
          const payload3 = { ...payload };
          delete payload3.address1;
          delete payload3.address2;
          payload3.address = [bizAddress1.trim(), bizAddress2.trim()].filter(Boolean).join('\n') || null;
          await attemptUpdate(payload3);
        }
      }

      // Refresh displayed formatting from normalized values
      setBizEmail(normalizedEmail);
      setBizEmailInvalid(false);
      setBizPhone(formatPhoneDisplay(normalizedPhone));
      setBizWebsite(normalizedWebsite);
      setBizState(normalizedState);
      setBizZip(formatZipDisplay(normalizedZip));

      showToast('success', 'Business profile saved.');
    } finally {
      setBizSaving(false);
    }
  }

  async function handleChangePassword() {
    setPasswordError(null);

    if (!sessionUserId) {
      showToast('error', 'Please log in to change your password.');
      return;
    }

    if (newPassword.length < 8) {
      const msg = 'Password must be at least 8 characters.';
      setPasswordError(msg);
      showToast('error', msg);
      return;
    }

    if (newPassword !== confirmPassword) {
      const msg = 'Passwords do not match.';
      setPasswordError(msg);
      showToast('error', msg);
      return;
    }

    setPasswordSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        const msg = error.message || 'Could not update password.';
        setPasswordError(msg);
        showToast('error', msg);
        return;
      }
      setNewPassword('');
      setConfirmPassword('');
      showToast('success', 'Password updated.');
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleDeleteAccount() {
    setDeleteError(null);

    if (!sessionUserId) {
      showToast('error', 'Please log in to delete your account.');
      return;
    }

    if (!deleteAcknowledge || deleteConfirm.trim() !== 'DELETE') {
      const msg = 'Please check the box and type DELETE to confirm.';
      setDeleteError(msg);
      showToast('error', msg);
      return;
    }

    const ok = window.confirm(
      'This will permanently delete your account and data. Are you sure?'
    );
    if (!ok) return;

    setDeleting(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? null;
      if (!token) {
        const msg = 'Missing session token. Please log in again and retry.';
        setDeleteError(msg);
        showToast('error', msg);
        return;
      }

      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });

      const payload = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        const msg = String(payload?.error ?? 'Account deletion failed.');
        setDeleteError(msg);
        showToast('error', msg);
        return;
      }

      try {
        await supabase.auth.signOut();
      } catch {
        // ignore
      }

      showToast('success', 'Account deleted.');
      router.push('/');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="space-y-3">
      {toast && (
        <div className="fixed bottom-4 right-4 z-[100] max-w-[92vw] sm:max-w-sm">
          <div
            className={`rounded-2xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${
              toast.type === 'success'
                ? 'border-emerald-500/40 bg-emerald-950/70 text-emerald-100 shadow-emerald-500/20'
                : toast.type === 'error'
                ? 'border-rose-500/40 bg-rose-950/70 text-rose-100 shadow-rose-500/20'
                : 'border-slate-700 bg-slate-950/70 text-slate-100 shadow-slate-900/40'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="leading-snug">{toast.message}</div>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="text-xs opacity-70 hover:opacity-100"
                aria-label="Close notification"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-slate-400 text-sm mt-1">
            Manage your account and preferences
          </p>
        </div>
      </header>

      {/* Sticky tabs */}
      <div className="sticky top-0 z-40 -mx-2 px-2 pt-1 pb-2">
        <div className="mx-auto w-full max-w-5xl">
          <div className="grid grid-cols-4 gap-1 rounded-2xl border border-slate-800 bg-slate-950/60 p-1 shadow-sm">
            {[
              { key: 'business' as const, label: 'Business', icon: <Building2 className="h-4 w-4" /> },
              { key: 'profile' as const, label: 'Profile', icon: <User className="h-4 w-4" /> },
              { key: 'security' as const, label: 'Security', icon: <Shield className="h-4 w-4" /> },
              { key: 'billing' as const, label: 'Billing', icon: <CreditCard className="h-4 w-4" /> },
            ].map((t) => {
              const selected = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    router.push(`/settings?tab=${t.key}`);
                    try {
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    } catch {
                      // ignore
                    }
                  }}
                  className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                    selected
                      ? 'bg-white/10 text-slate-50 border border-white/10 shadow-sm'
                      : 'text-slate-300 hover:text-slate-50 hover:bg-white/5 border border-transparent'
                  }`}
                  aria-current={selected ? 'page' : undefined}
                >
                  <span className={selected ? 'text-emerald-200' : 'text-slate-400'}>{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Active tab panel */}
      <div className="mx-auto w-full max-w-5xl pt-2">
        {/* Business Profile */}
        <section
          hidden={activeTab !== 'business'}
          className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 md:p-5"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-500/25">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Business Profile</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Used on invoices and client-facing documents. Required: name + (email or phone).
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSaveBusinessProfile}
              disabled={!sessionUserId || bizLoading || bizSaving}
              className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {bizSaving ? 'Saving…' : 'Save'}
            </button>
          </div>

          {!sessionUserId && (
            <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Please sign in to view and edit your business profile.
            </div>
          )}

          {bizError && (
            <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {bizError}
            </div>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="block text-[11px] text-slate-400">Business name *</label>
            <input
              value={bizName}
              onChange={(e) => setBizName(e.target.value)}
              placeholder="My Business"
              disabled={!sessionUserId || bizLoading}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-2">
                <Mail className="h-4 w-4 text-slate-500" />
                Email
              </span>
            </label>
            <input
              value={bizEmail}
              onChange={(e) => {
                const v = e.target.value;
                setBizEmail(v);
                const normalized = normalizeEmailForDb(v);
                setBizEmailInvalid(Boolean(normalized) && !isValidEmail(normalized));
              }}
              placeholder="billing@mybusiness.com"
              disabled={!sessionUserId || bizLoading}
              className={`w-full rounded-xl border bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 ${
                bizEmailInvalid
                  ? 'border-rose-500/60 focus:ring-rose-500'
                  : 'border-slate-700 focus:ring-indigo-500'
              }`}
            />
            {bizEmailInvalid ? (
              <div className="text-[11px] text-rose-300">Enter a valid email.</div>
            ) : null}
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-2">
                <Phone className="h-4 w-4 text-slate-500" />
                Phone
              </span>
            </label>
            <input
              value={bizPhone}
              onChange={(e) => setBizPhone(formatPhoneDisplay(e.target.value))}
              placeholder="(555) 555-5555"
              disabled={!sessionUserId || bizLoading}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-2">
                <Globe className="h-4 w-4 text-slate-500" />
                Website
              </span>
            </label>
            <input
              value={bizWebsite}
              onChange={(e) => setBizWebsite(e.target.value)}
              onBlur={() => {
                const normalized = normalizeWebsiteForDb(bizWebsite);
                setBizWebsite(normalized);
              }}
              placeholder="mybusiness.com"
              disabled={!sessionUserId || bizLoading}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <label className="block text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-slate-500" />
                Logo URL
              </span>
            </label>
            <input
              value={bizLogoUrl}
              onChange={(e) => setBizLogoUrl(e.target.value)}
              placeholder="https://.../logo.png"
              disabled={!sessionUserId || bizLoading}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <label className="block text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-2">
                <MapPin className="h-4 w-4 text-slate-500" />
                Address line 1
              </span>
            </label>
            <input
              value={bizAddress1}
              onChange={(e) => setBizAddress1(e.target.value)}
              placeholder="123 Main St"
              disabled={!sessionUserId || bizLoading}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <label className="block text-[11px] text-slate-400">Address line 2</label>
            <input
              value={bizAddress2}
              onChange={(e) => setBizAddress2(e.target.value)}
              placeholder="Suite, unit, etc. (optional)"
              disabled={!sessionUserId || bizLoading}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] text-slate-400">City</label>
            <input
              value={bizCity}
              onChange={(e) => setBizCity(e.target.value)}
              placeholder="Austin"
              disabled={!sessionUserId || bizLoading}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] text-slate-400">State</label>
            <input
              value={bizState}
              onChange={(e) => setBizState(normalizeStateForDb(e.target.value))}
              placeholder="TX"
              disabled={!sessionUserId || bizLoading}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] text-slate-400">ZIP</label>
            <input
              value={bizZip}
              onChange={(e) => setBizZip(formatZipDisplay(e.target.value))}
              placeholder="12345 or 12345-6789"
              disabled={!sessionUserId || bizLoading}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] text-slate-400"> </label>
            <div className="text-[11px] text-slate-500">
              {bizLoading ? 'Loading…' : bizId ? `Business ID: ${bizId}` : ''}
            </div>
          </div>
        </div>
        </section>

        {/* Profile */}
        <section
          hidden={activeTab !== 'profile'}
          className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 md:p-5"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Profile</h2>
              <p className="text-xs text-slate-400 mt-1">
                Update your personal details.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-4">
            {!sessionUserId && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Please sign in to view and edit your settings.
              </div>
            )}

            {profileError && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                {profileError}
              </div>
            )}

            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-sm font-semibold text-emerald-300 border border-emerald-500/30">
                {avatarInitials}
              </div>
              <div className="flex-1 min-w-0">
                <label className="block text-[11px] text-slate-400">Email</label>
                <input
                  value={sessionEmail || ''}
                  readOnly
                  placeholder="you@example.com"
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 outline-none"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Email is read-only right now.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="block text-[11px] text-slate-400">
                  Full name
                </label>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Jane Doe"
                  disabled={!sessionUserId || profileLoading}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] text-slate-400">Phone</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 555-5555"
                  disabled={!sessionUserId || profileLoading}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] text-slate-400">City</label>
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Austin"
                  disabled={!sessionUserId || profileLoading}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] text-slate-400">Country</label>
                <input
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="United States"
                  disabled={!sessionUserId || profileLoading}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => void handleSaveProfile()}
                disabled={!sessionUserId || profileLoading || profileSaving}
                className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 shadow-sm hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {profileSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </section>

      {/* Security (password/session + danger zone) */}
      <div hidden={activeTab !== 'security'} className="space-y-4">
        <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 md:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Security</h2>
              <p className="text-xs text-slate-400 mt-1">
                Password and session management.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="text-xs font-semibold text-slate-100">
                Change password
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                Set a new password for your account.
              </p>

              {passwordError && (
                <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
                  {passwordError}
                </div>
              )}

              <div className="mt-3 space-y-3">
                <div className="space-y-1">
                  <label className="block text-[11px] text-slate-400">
                    New password
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={!sessionUserId || passwordSaving}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="••••••••"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] text-slate-400">
                    Confirm new password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={!sessionUserId || passwordSaving}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="••••••••"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleChangePassword()}
                    disabled={
                      !sessionUserId ||
                      passwordSaving ||
                      newPassword.length < 8 ||
                      newPassword !== confirmPassword
                    }
                    className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {passwordSaving ? 'Updating…' : 'Update password'}
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="text-xs font-semibold text-slate-100">Session</div>
              <p className="mt-1 text-[11px] text-slate-400">
                Sign out from this device.
              </p>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  disabled={signingOut}
                  className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-950/40 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900/70 disabled:opacity-50"
                >
                  {signingOut ? 'Signing out…' : 'Sign out'}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-rose-500/40 bg-rose-950/20 p-4 md:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-rose-100">Danger Zone</h2>
              <p className="text-xs text-rose-200/80 mt-1">
                Deletion is permanent and cannot be undone.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {deleteError && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                {deleteError}
              </div>
            )}

            <div className="text-xs text-rose-200/80">
              Deleting your account will remove your data and revoke access
              immediately.
            </div>

            <label className="flex items-center gap-2 text-xs text-rose-100">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={deleteAcknowledge}
                onChange={(e) => setDeleteAcknowledge(e.target.checked)}
                disabled={!sessionUserId || deleting}
              />
              I understand this is permanent.
            </label>

            <div className="grid gap-2 sm:grid-cols-2 sm:items-end">
              <div className="space-y-1">
                <label className="block text-[11px] text-rose-200/80">
                  Type <span className="font-semibold text-rose-100">DELETE</span>{' '}
                  to confirm
                </label>
                <input
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder="DELETE"
                  disabled={!sessionUserId || deleting}
                  className="w-full rounded-xl border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-sm text-rose-50 placeholder:text-rose-200/40 outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleDeleteAccount()}
                  disabled={
                    !sessionUserId ||
                    deleting ||
                    !deleteAcknowledge ||
                    deleteConfirm.trim() !== 'DELETE'
                  }
                  className="inline-flex items-center justify-center rounded-xl bg-rose-500 px-4 py-2 text-xs font-semibold text-slate-950 shadow-sm hover:bg-rose-400 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {deleting ? 'Deleting…' : 'Delete account'}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Billing */}
      <section
        hidden={activeTab !== 'billing'}
        className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 md:p-5"
      >
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/25">
            <CreditCard className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Billing</h2>
            <p className="text-xs text-slate-400 mt-1">
              Manage your plan and subscription.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
          <div className="text-sm text-slate-200">Billing settings live in the Pricing flow.</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => router.push('/pricing')}
              className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500"
            >
              View plans
            </button>
          </div>
        </div>
      </section>
      </div>
    </main>
  );
}
