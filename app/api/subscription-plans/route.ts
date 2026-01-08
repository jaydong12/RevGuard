import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { PLAN_META } from '../../../lib/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getBearerToken(request: Request): string | null {
  const auth = request.headers.get('authorization') ?? '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7);
  const cookie = request.headers.get('cookie') ?? '';
  // Optional: allow middleware cookie passthrough (if present).
  const m = cookie.match(/(?:^|;\s*)rg_at=([^;]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

function normalizePlanLabel(id: string) {
  const s = String(id ?? '').trim().toLowerCase();
  if (s === 'starter') return 'Starter';
  if (s === 'growth') return 'Growth';
  if (s === 'pro') return 'Pro';
  return id;
}

function fmtDollarsFromCents(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined) return null;
  const n = Number(cents);
  if (!Number.isFinite(n)) return null;
  return Math.round(n) / 100;
}

function fallbackPlans() {
  return (Object.values(PLAN_META) ?? []).map((p) => ({
    id: p.id,
    label: p.label,
    priceMonthly: p.priceMonthly,
    promoFirstMonth: p.promoFirstMonth,
  }));
}

export async function GET(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const token = getBearerToken(request);

    // Pricing page must never hard-require server-only env vars.
    // If Supabase env or auth is missing, return a safe, static fallback.
    if (!supabaseUrl || !anonKey || !token) {
      return NextResponse.json({ plans: fallbackPlans(), source: 'fallback' as const });
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data, error } = await supabase
      .from('subscription_plans')
      .select('id,stripe_price_id,stripe_coupon_id')
      .order('id', { ascending: true });

    if (error) {
      return NextResponse.json({
        plans: fallbackPlans(),
        source: 'fallback' as const,
        warning: error.message,
      });
    }

    const rows = (data ?? []) as Array<{
      id: string;
      stripe_price_id: string;
      stripe_coupon_id: string | null;
    }>;

    const secretKey = process.env.STRIPE_SECRET_KEY ?? null;
    const stripe = secretKey ? new Stripe(secretKey) : null;

    const metaById = new Map(Object.values(PLAN_META).map((p) => [p.id, p]));

    const plans = await Promise.all(
      rows.map(async (p) => {
        const id = String(p.id);
        const meta = metaById.get(id as any);

        // Default to PLAN_META pricing (fallback), and enrich from Stripe when available.
        let priceMonthly: number | null =
          meta && typeof meta.priceMonthly === 'number' ? meta.priceMonthly : null;
        let promoFirstMonth: number | null =
          meta && typeof meta.promoFirstMonth === 'number' ? meta.promoFirstMonth : null;

        if (stripe && p.stripe_price_id) {
          try {
            const price = await stripe.prices.retrieve(p.stripe_price_id);
            const unitAmount = (price as any).unit_amount as number | null;
            const monthly = fmtDollarsFromCents(unitAmount);
            if (monthly !== null) {
              priceMonthly = monthly;
              promoFirstMonth = null;

              if (p.stripe_coupon_id) {
                try {
                  const coupon = await stripe.coupons.retrieve(p.stripe_coupon_id);
                  const percentOff = (coupon as any).percent_off as number | null;
                  const amountOff = (coupon as any).amount_off as number | null;
                  if (typeof percentOff === 'number' && Number.isFinite(percentOff)) {
                    const discounted = (monthly * (100 - percentOff)) / 100;
                    promoFirstMonth = Math.max(0, Math.round(discounted * 100) / 100);
                  } else if (typeof amountOff === 'number' && Number.isFinite(amountOff)) {
                    const discounted = (monthly * 100 - amountOff) / 100;
                    promoFirstMonth = Math.max(0, Math.round(discounted * 100) / 100);
                  }
                } catch {
                  promoFirstMonth = null;
                }
              }
            }
          } catch {
            // keep fallback pricing
          }
        }

        return {
          id,
          label: normalizePlanLabel(id),
          priceMonthly,
          promoFirstMonth,
        };
      })
    );

    return NextResponse.json({ plans, source: stripe ? ('live' as const) : ('db' as const) });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('SUBSCRIPTION_PLANS_ERROR', e);
    // Important: don't crash pricing page; return fallback.
    return NextResponse.json({ plans: fallbackPlans(), source: 'fallback' as const });
  }
}


