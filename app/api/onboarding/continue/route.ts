import { NextResponse } from 'next/server';
import { getSupabaseUserClient } from '../../../../lib/server/supabaseUserClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getBearerToken(request: Request): string | null {
  const auth = request.headers.get('authorization') ?? '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7);
  return null;
}

function normalizeStep(raw: any): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  // 10 screens (0..9)
  if (i < 0 || i > 9) return null;
  return i;
}

function mergeJson(a: any, b: any) {
  const aa = a && typeof a === 'object' ? a : {};
  const bb = b && typeof b === 'object' ? b : {};
  return { ...aa, ...bb };
}

async function ensureBusinessForUser(supabase: any, userId: string, businessNameHint?: string | null) {
  // If user has a membership, use the first one.
  const mem = await supabase
    .from('business_members')
    .select('business_id, role')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!mem.error && mem.data?.business_id) {
    return { businessId: String(mem.data.business_id), created: false };
  }

  // No membership row → create a business owned by the user, then insert membership as owner.
  const name = String(businessNameHint ?? '').trim() || 'My Business';
  const created = await supabase
    .from('business')
    .insert({ owner_id: userId, name } as any)
    .select('id')
    .single();
  if (created.error || !created.data?.id) {
    throw new Error(created.error?.message ?? 'Failed to create business.');
  }
  const businessId = String(created.data.id);

  const insMember = await supabase
    .from('business_members')
    .insert({ business_id: businessId, user_id: userId, role: 'owner' } as any)
    .select('id')
    .single();
  if (insMember.error) {
    throw new Error(insMember.error.message ?? 'Failed to create business membership.');
  }

  return { businessId, created: true };
}

export async function POST(request: Request) {
  try {
    const token = getBearerToken(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json().catch(() => null)) as any;
    const step = normalizeStep(body?.step);
    if (step === null) return NextResponse.json({ error: 'Invalid step.' }, { status: 400 });

    const supabase = getSupabaseUserClient(token);
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = String(userRes.user.id);

    // Always ensure a business exists on each Continue (per spec).
    const ensured = await ensureBusinessForUser(supabase, userId, body?.business_name ?? null);
    const businessId = ensured.businessId;

    // Load current preferences (best-effort).
    let currentPrefs: any = {};
    try {
      const biz = await supabase.from('business').select('id, preferences').eq('id', businessId).maybeSingle();
      currentPrefs = (biz.data as any)?.preferences ?? {};
    } catch {
      currentPrefs = {};
    }

    const nextStep = step >= 9 ? 9 : step + 1;
    const complete = step >= 9;

    // -------------------------
    // Step-specific validation + payload
    // -------------------------
    const profilePatch: any = {
      id: userId,
      onboarding_step: nextStep,
      onboarding_complete: Boolean(complete),
    };

    const businessPatch: any = {
      id: businessId,
      onboarding_step: nextStep,
      onboarding_complete: Boolean(complete),
    };

    // Screen 1: Profile A (full_name)
    if (step === 1) {
      const fullName = String(body?.full_name ?? '').trim();
      if (!fullName) return NextResponse.json({ error: 'Full name is required.' }, { status: 400 });
      profilePatch.full_name = fullName;
    }

    // Screen 2: Profile B (role)
    if (step === 2) {
      const roleRaw = String(body?.role ?? '').trim().toLowerCase();
      const allowed = new Set(['owner', 'manager', 'accountant', 'personal']);
      if (!allowed.has(roleRaw)) return NextResponse.json({ error: 'Select a role.' }, { status: 400 });
      profilePatch.role = roleRaw;
    }

    // Screen 3: Business A (name)
    if (step === 3) {
      const businessName = String(body?.business_name ?? '').trim();
      if (!businessName) return NextResponse.json({ error: 'Business name is required.' }, { status: 400 });
      businessPatch.name = businessName;
    }

    // Screen 4: Business B (industry)
    if (step === 4) {
      const industryRaw = String(body?.industry ?? '').trim().toLowerCase();
      const allowed = new Set(['contractor', 'restaurant', 'retail', 'services', 'real_estate', 'other']);
      if (!allowed.has(industryRaw)) return NextResponse.json({ error: 'Select an industry.' }, { status: 400 });
      businessPatch.industry = industryRaw;
    }

    // Screen 5: Business C (timezone + location)
    if (step === 5) {
      const tz = String(body?.timezone ?? '').trim();
      const loc = String(body?.location ?? '').trim();
      if (!tz) return NextResponse.json({ error: 'Timezone is required.' }, { status: 400 });
      businessPatch.timezone = tz;
      businessPatch.location = loc || null;
    }

    // Screen 6: Preferences (modules toggles) -> business.preferences.modules
    if (step === 6) {
      if (!body?.modules || typeof body.modules !== 'object') {
        return NextResponse.json({ error: 'Missing module preferences.' }, { status: 400 });
      }
      const nextPrefs = mergeJson(currentPrefs, {});
      nextPrefs.modules = mergeJson(nextPrefs.modules, body.modules);
      businessPatch.preferences = nextPrefs;
    }

    // Screen 7: Connect money -> business.preferences.connect_money (+ optional csv_uploaded)
    if (step === 7) {
      const connectMoney = String(body?.connect_money ?? '').trim().toLowerCase();
      const allowed = new Set(['stripe', 'csv', 'skip']);
      if (!allowed.has(connectMoney)) {
        return NextResponse.json({ error: 'Choose a connection method.' }, { status: 400 });
      }
      const nextPrefs = mergeJson(currentPrefs, {});
      nextPrefs.connect_money = connectMoney;
      if (connectMoney === 'csv') {
        nextPrefs.csv_uploaded = Boolean(body?.csv_uploaded);
      }
      businessPatch.preferences = nextPrefs;
    }

    // Screen 8: Smart setup flags -> business.preferences.flags
    if (step === 8) {
      const hasEmployees = body?.has_employees;
      const usesVehicle = body?.uses_vehicle;
      const hasRent = body?.has_rent;
      if (hasEmployees === undefined || usesVehicle === undefined || hasRent === undefined) {
        return NextResponse.json({ error: 'Answer all 3 questions.' }, { status: 400 });
      }
      const nextPrefs = mergeJson(currentPrefs, {});
      nextPrefs.flags = mergeJson(nextPrefs.flags, {
        has_employees: Boolean(hasEmployees),
        uses_vehicle: Boolean(usesVehicle),
        has_rent: Boolean(hasRent),
      });
      businessPatch.preferences = nextPrefs;
    }

    // Screen 9: Success/finalize (mark complete)
    if (step === 9) {
      profilePatch.onboarding_step = 9;
      profilePatch.onboarding_complete = true;
      businessPatch.onboarding_step = 9;
      businessPatch.onboarding_complete = true;
    }

    // -------------------------
    // Persist
    // -------------------------
    const upProfile = await supabase
      .from('profiles')
      .upsert(profilePatch as any, { onConflict: 'id' })
      .select('onboarding_step,onboarding_complete')
      .single();

    if (upProfile.error) {
      return NextResponse.json({ error: upProfile.error.message ?? 'Failed to save profile.' }, { status: 400 });
    }

    const upBiz = await supabase
      .from('business')
      .update(businessPatch as any)
      .eq('id', businessId)
      .select('onboarding_step,onboarding_complete')
      .single();
    if (upBiz.error) {
      return NextResponse.json({ error: upBiz.error.message ?? 'Failed to save business.' }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      nextStep,
      onboarding_complete: Boolean(complete),
      business_id: businessId,
    });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('ONBOARDING_CONTINUE_ERROR', e);
    return NextResponse.json({ error: e?.message ?? 'Onboarding failed.' }, { status: 500 });
  }
}


