import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/server/supabaseAdmin';
import { getStripeServer } from '../../../lib/server/stripeServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const stripe = getStripeServer();

    const { data, error } = await supabase
      .from('subscription_plans')
      .select('id,stripe_price_id,stripe_coupon_id')
      .order('id', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as Array<{
      id: string;
      stripe_price_id: string;
      stripe_coupon_id: string | null;
    }>;

    const plans = await Promise.all(
      rows.map(async (p) => {
        const price = await stripe.prices.retrieve(p.stripe_price_id);
        const unitAmount = (price as any).unit_amount as number | null;
        const monthly = fmtDollarsFromCents(unitAmount);

        let promoFirstMonth: number | null = null;
        if (p.stripe_coupon_id && monthly !== null) {
          try {
            const coupon = await stripe.coupons.retrieve(p.stripe_coupon_id);
            const percentOff = (coupon as any).percent_off as number | null;
            const amountOff = (coupon as any).amount_off as number | null;
            if (typeof percentOff === 'number' && Number.isFinite(percentOff)) {
              promoFirstMonth = Math.max(0, Math.round((monthly * (100 - percentOff)) * 100) / 100);
            } else if (typeof amountOff === 'number' && Number.isFinite(amountOff)) {
              promoFirstMonth = Math.max(0, Math.round(((monthly * 100 - amountOff) / 100) * 100) / 100);
            }
          } catch {
            promoFirstMonth = null;
          }
        }

        return {
          id: p.id,
          label: normalizePlanLabel(p.id),
          priceMonthly: monthly,
          promoFirstMonth,
        };
      })
    );

    return NextResponse.json({ plans });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('SUBSCRIPTION_PLANS_ERROR', e);
    return NextResponse.json({ error: e?.message ?? 'Failed to load plans.' }, { status: 500 });
  }
}


