'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../utils/supabaseClient';

type Role = 'owner' | 'manager' | 'accountant' | 'personal';
type Industry =
  | 'contractor'
  | 'restaurant'
  | 'retail'
  | 'services'
  | 'real_estate'
  | 'other';
type ConnectMoney = 'stripe' | 'csv' | 'skip';

type ModulesPrefs = {
  income_expenses: boolean;
  bills_ap: boolean;
  invoices_ar: boolean;
  payroll: boolean;
  bookings: boolean;
  ai_alerts: boolean;
};

const TOTAL_SCREENS = 10; // 0..9

function clampStep(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(9, Math.trunc(n)));
}

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full rounded-full bg-slate-800/70 overflow-hidden">
      <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

async function postContinue(token: string, payload: any) {
  const res = await fetch('/api/onboarding/continue', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    throw new Error(String(body?.error ?? 'Could not save.'));
  }
  return body as { ok: true; nextStep: number; onboarding_complete: boolean; business_id?: string | null };
}

export default function OnboardingClient() {
  const router = useRouter();

  const [booting, setBooting] = React.useState(true);
  const [step, setStep] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [fullName, setFullName] = React.useState('');
  const [role, setRole] = React.useState<Role | ''>('');
  const [businessName, setBusinessName] = React.useState('');
  const [industry, setIndustry] = React.useState<Industry | ''>('');
  const [timezone, setTimezone] = React.useState('');
  const [location, setLocation] = React.useState('');

  const [modules, setModules] = React.useState<ModulesPrefs>({
    income_expenses: true,
    bills_ap: true,
    invoices_ar: true,
    payroll: false,
    bookings: false,
    ai_alerts: true,
  });

  const [connectMoney, setConnectMoney] = React.useState<ConnectMoney | ''>('');
  const [csvFileName, setCsvFileName] = React.useState<string | null>(null);

  const [hasEmployees, setHasEmployees] = React.useState<boolean | null>(null);
  const [usesVehicle, setUsesVehicle] = React.useState<boolean | null>(null);
  const [hasRent, setHasRent] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    // Auto-detect timezone (safe, client-only).
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz && !timezone) setTimezone(tz);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    let alive = true;
    async function load() {
      setBooting(true);
      setError(null);
      try {
        const { data } = await supabase.auth.getSession();
        const session = data.session ?? null;
        if (!session?.access_token || !session.user?.id) return;

        // Load profile
        const prof = await supabase
          .from('profiles')
          .select('full_name,role,onboarding_step,onboarding_complete')
          .eq('id', session.user.id)
          .maybeSingle();
        const p = (prof.data as any) ?? null;
        if (p?.full_name) setFullName(String(p.full_name));
        if (p?.role) {
          const r = String(p.role).trim().toLowerCase();
          if (r === 'owner' || r === 'manager' || r === 'accountant' || r === 'personal') setRole(r);
        }
        const savedStep = clampStep(Number(p?.onboarding_step ?? 0));
        if (p?.onboarding_complete === true) {
          router.replace('/app');
          return;
        }

        // Load business (first membership)
        const mem = await supabase
          .from('business_members')
          .select('business_id')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        const businessId = (mem.data as any)?.business_id ? String((mem.data as any).business_id) : null;
        if (businessId) {
          const biz = await supabase
            .from('business')
            .select('name,industry,timezone,location,preferences,onboarding_complete,onboarding_step')
            .eq('id', businessId)
            .maybeSingle();
          const b = (biz.data as any) ?? null;
          if (b?.name) setBusinessName(String(b.name));
          if (b?.industry) {
            const i = String(b.industry).trim().toLowerCase();
            if (
              i === 'contractor' ||
              i === 'restaurant' ||
              i === 'retail' ||
              i === 'services' ||
              i === 'real_estate' ||
              i === 'other'
            ) {
              setIndustry(i);
            }
          }
          if (b?.timezone) setTimezone(String(b.timezone));
          if (b?.location) setLocation(String(b.location));

          const prefs = (b?.preferences && typeof b.preferences === 'object' ? b.preferences : {}) as any;
          if (prefs?.modules && typeof prefs.modules === 'object') {
            setModules((prev) => ({
              ...prev,
              ...prefs.modules,
            }));
          }
          if (prefs?.connect_money) {
            const c = String(prefs.connect_money).trim().toLowerCase();
            if (c === 'stripe' || c === 'csv' || c === 'skip') setConnectMoney(c);
          }
          if (prefs?.csv_uploaded) setCsvFileName('Uploaded');
          if (prefs?.flags && typeof prefs.flags === 'object') {
            const f = prefs.flags as any;
            if (typeof f.has_employees === 'boolean') setHasEmployees(f.has_employees);
            if (typeof f.uses_vehicle === 'boolean') setUsesVehicle(f.uses_vehicle);
            if (typeof f.has_rent === 'boolean') setHasRent(f.has_rent);
          }
        }

        // Resume from whichever is further along.
        if (!alive) return;
        setStep(savedStep);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? 'Could not load onboarding.');
      } finally {
        if (alive) setBooting(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [router]);

  async function continueFrom(currentStep: number) {
    setSaving(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? null;
      if (!token) {
        setError('Please sign in to continue.');
        return;
      }

      // step-specific payload
      const payload: any = { step: currentStep };

      if (currentStep === 1) payload.full_name = fullName.trim();
      if (currentStep === 2) payload.role = role;
      if (currentStep === 3) payload.business_name = businessName.trim();
      if (currentStep === 4) payload.industry = industry;
      if (currentStep === 5) {
        payload.timezone = timezone.trim();
        payload.location = location.trim();
      }
      if (currentStep === 6) payload.modules = modules;
      if (currentStep === 7) {
        payload.connect_money = connectMoney;
        payload.csv_uploaded = Boolean(csvFileName);
      }
      if (currentStep === 8) {
        payload.has_employees = hasEmployees;
        payload.uses_vehicle = usesVehicle;
        payload.has_rent = hasRent;
      }

      // Client-side friendly validation (server will also validate)
      if (currentStep === 1 && !payload.full_name) throw new Error('Full name is required.');
      if (currentStep === 2 && !payload.role) throw new Error('Select a role.');
      if (currentStep === 3 && !payload.business_name) throw new Error('Business name is required.');
      if (currentStep === 4 && !payload.industry) throw new Error('Select an industry.');
      if (currentStep === 5 && !payload.timezone) throw new Error('Timezone is required.');
      if (currentStep === 7 && !payload.connect_money) throw new Error('Choose one option.');
      if (
        currentStep === 8 &&
        (hasEmployees === null || usesVehicle === null || hasRent === null)
      ) {
        throw new Error('Answer all 3 questions.');
      }

      const res = await postContinue(token, payload);
      const next = clampStep(Number(res.nextStep ?? currentStep + 1));
      setStep(next);

      if (next === 9) {
        // finalize immediately
        const fin = await postContinue(token, { step: 9 });
        if (fin.onboarding_complete) {
          router.replace('/app');
        }
      }
    } catch (e: any) {
      setError(String(e?.message ?? 'Could not save.'));
    } finally {
      setSaving(false);
    }
  }

  function goBack() {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  }

  const pct = Math.round(((step + 1) / TOTAL_SCREENS) * 100);

  if (booting) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="text-sm text-slate-300">Loading onboarding…</div>
      </div>
    );
  }

  return (
    <main className="max-w-xl mx-auto">
      <div className="mb-6">
        <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Setup</div>
        <div className="mt-3">
          <ProgressBar value={pct} />
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Step {step + 1} of {TOTAL_SCREENS}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-800/80 bg-slate-950/45 backdrop-blur-sm shadow-[0_30px_90px_rgba(0,0,0,0.35)] overflow-hidden">
        <div className="p-6 md:p-8">
          {step === 0 ? (
            <div className="space-y-4">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-50">
                Let’s set up RevGuard
              </h1>
              <p className="text-sm md:text-base text-slate-300 leading-relaxed">
                We’ll ask a few quick questions so your dashboard feels instantly tailored.
              </p>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-4">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-50">
                What should we call you?
              </h1>
              <label className="block">
                <div className="text-xs text-slate-300">Full name</div>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-2 w-full rounded-2xl bg-slate-950/60 border border-slate-800 px-4 py-3 text-slate-100"
                  placeholder="Jane Doe"
                  autoComplete="name"
                />
              </label>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-50">
                Your role
              </h1>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { id: 'owner', label: 'Owner', desc: 'Run the business' },
                  { id: 'manager', label: 'Manager', desc: 'Lead operations' },
                  { id: 'accountant', label: 'Accountant', desc: 'Handle books' },
                  { id: 'personal', label: 'Personal', desc: 'Track personal finances' },
                ] as Array<{ id: Role; label: string; desc: string }>).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRole(r.id)}
                    className={classNames(
                      'text-left rounded-2xl border px-4 py-4 transition',
                      role === r.id
                        ? 'border-emerald-500/50 bg-emerald-500/10'
                        : 'border-slate-800 bg-slate-950/40 hover:bg-slate-900/40'
                    )}
                  >
                    <div className="text-sm font-semibold text-slate-100">{r.label}</div>
                    <div className="mt-1 text-xs text-slate-400">{r.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-4">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-50">
                Business name
              </h1>
              <label className="block">
                <div className="text-xs text-slate-300">Business</div>
                <input
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="mt-2 w-full rounded-2xl bg-slate-950/60 border border-slate-800 px-4 py-3 text-slate-100"
                  placeholder="Acme Services"
                />
              </label>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-4">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-50">
                Industry
              </h1>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { id: 'contractor', label: 'Contractor' },
                  { id: 'restaurant', label: 'Restaurant' },
                  { id: 'retail', label: 'Retail' },
                  { id: 'services', label: 'Services' },
                  { id: 'real_estate', label: 'Real Estate' },
                  { id: 'other', label: 'Other' },
                ] as Array<{ id: Industry; label: string }>).map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => setIndustry(x.id)}
                    className={classNames(
                      'rounded-2xl border px-4 py-4 text-left transition',
                      industry === x.id
                        ? 'border-emerald-500/50 bg-emerald-500/10'
                        : 'border-slate-800 bg-slate-950/40 hover:bg-slate-900/40'
                    )}
                  >
                    <div className="text-sm font-semibold text-slate-100">{x.label}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {step === 5 ? (
            <div className="space-y-4">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-50">
                Timezone & location
              </h1>
              <label className="block">
                <div className="text-xs text-slate-300">Timezone</div>
                <input
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="mt-2 w-full rounded-2xl bg-slate-950/60 border border-slate-800 px-4 py-3 text-slate-100"
                  placeholder="America/New_York"
                />
                <div className="mt-2 text-[11px] text-slate-500">
                  Auto-detected when possible.
                </div>
              </label>
              <label className="block">
                <div className="text-xs text-slate-300">Location (optional)</div>
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="mt-2 w-full rounded-2xl bg-slate-950/60 border border-slate-800 px-4 py-3 text-slate-100"
                  placeholder="Austin, TX"
                />
              </label>
            </div>
          ) : null}

          {step === 6 ? (
            <div className="space-y-4">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-50">
                What should RevGuard track?
              </h1>
              <div className="space-y-2">
                {(Object.keys(modules) as Array<keyof ModulesPrefs>).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setModules((p) => ({ ...p, [k]: !p[k] }))}
                    className="w-full flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-4 hover:bg-slate-900/40"
                  >
                    <div className="text-left">
                      <div className="text-sm font-semibold text-slate-100">
                        {String(k).replace(/_/g, ' ')}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        You can change this any time.
                      </div>
                    </div>
                    <div
                      className={classNames(
                        'h-6 w-11 rounded-full border transition relative',
                        modules[k] ? 'bg-emerald-500/25 border-emerald-500/40' : 'bg-slate-900/40 border-slate-700/70'
                      )}
                    >
                      <div
                        className={classNames(
                          'absolute top-0.5 h-5 w-5 rounded-full bg-slate-200 transition',
                          modules[k] ? 'left-5' : 'left-0.5'
                        )}
                      />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {step === 7 ? (
            <div className="space-y-4">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-50">
                Connect money
              </h1>
              <div className="space-y-3">
                {([
                  { id: 'stripe', label: 'Stripe', desc: 'Connect payments (optional)' },
                  { id: 'csv', label: 'Upload CSV', desc: 'Bring in transactions quickly' },
                  { id: 'skip', label: 'Skip for now', desc: 'You can do this later' },
                ] as Array<{ id: ConnectMoney; label: string; desc: string }>).map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => setConnectMoney(x.id)}
                    className={classNames(
                      'w-full text-left rounded-2xl border px-4 py-4 transition',
                      connectMoney === x.id
                        ? 'border-emerald-500/50 bg-emerald-500/10'
                        : 'border-slate-800 bg-slate-950/40 hover:bg-slate-900/40'
                    )}
                  >
                    <div className="text-sm font-semibold text-slate-100">{x.label}</div>
                    <div className="mt-1 text-xs text-slate-400">{x.desc}</div>
                  </button>
                ))}
              </div>

              {connectMoney === 'csv' ? (
                <div className="mt-2 rounded-2xl border border-slate-800 bg-slate-950/30 p-4">
                  <div className="text-xs text-slate-300">Upload a CSV (optional right now)</div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <label className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-200 hover:bg-slate-900/50 cursor-pointer">
                      <input
                        type="file"
                        accept=".csv"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0] ?? null;
                          if (!f) return;
                          setCsvFileName(f.name);
                        }}
                      />
                      Choose file
                    </label>
                    <div className="text-xs text-slate-400 truncate">
                      {csvFileName ? csvFileName : 'No file selected'}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 8 ? (
            <div className="space-y-4">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-50">
                Smart setup
              </h1>
              <div className="space-y-3">
                <YesNo
                  label="Do you have employees?"
                  value={hasEmployees}
                  onChange={setHasEmployees}
                />
                <YesNo
                  label="Do you use a vehicle for work?"
                  value={usesVehicle}
                  onChange={setUsesVehicle}
                />
                <YesNo
                  label="Do you pay rent?"
                  value={hasRent}
                  onChange={setHasRent}
                />
              </div>
            </div>
          ) : null}

          {step === 9 ? (
            <div className="space-y-4">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-50">
                Building your dashboard…
              </h1>
              <p className="text-sm md:text-base text-slate-300 leading-relaxed">
                One moment — we’re setting up your workspace.
              </p>
            </div>
          ) : null}

          {error ? (
            <div className="mt-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}
        </div>

        <div className="border-t border-slate-800/70 bg-slate-950/40 p-4 md:p-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={goBack}
            disabled={saving || step === 0}
            className={classNames(
              'rounded-xl border px-4 py-2 text-sm font-semibold transition',
              saving || step === 0
                ? 'border-slate-800 bg-slate-950/20 text-slate-500 cursor-not-allowed'
                : 'border-slate-800 bg-slate-950/40 text-slate-200 hover:bg-slate-900/50'
            )}
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => continueFrom(step)}
            disabled={saving || step === 9}
            className={classNames(
              'rounded-xl px-4 py-2 text-sm font-semibold transition',
              saving || step === 9
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
            )}
          >
            {step === 0 ? 'Start' : saving ? 'Saving…' : 'Continue'}
          </button>
        </div>
      </div>
    </main>
  );
}

function YesNo({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="text-sm font-semibold text-slate-100">{label}</div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => onChange(true)}
          className={classNames(
            'flex-1 rounded-xl border px-3 py-2 text-sm font-semibold transition',
            value === true
              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-100'
              : 'border-slate-800 bg-slate-950/30 text-slate-200 hover:bg-slate-900/50'
          )}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          className={classNames(
            'flex-1 rounded-xl border px-3 py-2 text-sm font-semibold transition',
            value === false
              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-100'
              : 'border-slate-800 bg-slate-950/30 text-slate-200 hover:bg-slate-900/50'
          )}
        >
          No
        </button>
      </div>
    </div>
  );
}


