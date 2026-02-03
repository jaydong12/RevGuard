import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/server/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function normMerchantKey(v: string) {
  return String(v ?? '').trim().toLowerCase();
}

function ymd(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// TODO(Phase2/provider): Replace with Plaid / Stripe Financial Connections adapters.
function makeMockTransactions(seed: string) {
  const merchants = [
    { merchant: 'Amazon', desc: 'AMZN Mktp' },
    { merchant: 'Home Depot', desc: 'HOMEDEPOT' },
    { merchant: 'Stripe', desc: 'STRIPE PAYMENTS' },
    { merchant: 'Uber', desc: 'UBER TRIP' },
    { merchant: 'Starbucks', desc: 'STARBUCKS' },
    { merchant: 'Shell', desc: 'SHELL OIL' },
    { merchant: 'Apple', desc: 'APPLE.COM/BILL' },
    { merchant: 'Google', desc: 'GOOGLE *GSUITE' },
  ];

  // Deterministic-ish amounts based on seed.
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;

  const out: Array<{
    provider_transaction_id: string;
    posted_at: string;
    amount: number;
    currency: string;
    merchant_name: string;
    description: string;
  }> = [];

  for (let i = 0; i < 20; i++) {
    const m = merchants[(h + i) % merchants.length];
    const daysAgo = (h + i * 3) % 21;
    const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    const amtRaw = ((h % 9000) / 100 + i * 1.37) % 320;
    const isIncome = (h + i) % 11 === 0;
    const amount = Number((isIncome ? amtRaw : -amtRaw).toFixed(2));
    out.push({
      provider_transaction_id: `mock:${seed}:${ymd(d)}:${i}`,
      posted_at: ymd(d),
      amount,
      currency: 'USD',
      merchant_name: m.merchant,
      description: m.desc,
    });
  }
  return out;
}

export async function POST(request: Request) {
  try {
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json().catch(() => null)) as any;
    const businessIdRaw = String(body?.businessId ?? '').trim();

    const admin = getSupabaseAdmin();
    const { data: tokenUserRes, error: tokenUserErr } = await admin.auth.getUser(token);
    const user = tokenUserRes?.user ?? null;
    if (tokenUserErr || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Determine business_id (prefer explicit businessId but validate membership).
    let businessId: string | null = null;
    if (businessIdRaw) {
      if (!isUuid(businessIdRaw)) return NextResponse.json({ error: 'Invalid businessId' }, { status: 400 });
      businessId = businessIdRaw;
      const { data: bm } = await admin
        .from('business_members')
        .select('business_id')
        .eq('business_id', businessId)
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      if (!(bm as any)?.business_id) {
        // fallback: owners may not have business_members row
        const { data: biz } = await admin
          .from('business')
          .select('id, owner_id')
          .eq('id', businessId)
          .maybeSingle();
        if (String((biz as any)?.owner_id ?? '') !== user.id) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
      }
    } else {
      const { data: bm } = await admin
        .from('business_members')
        .select('business_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      businessId = (bm as any)?.business_id ? String((bm as any).business_id) : null;
      if (!businessId) {
        const { data: biz } = await admin
          .from('business')
          .select('id, owner_id')
          .eq('owner_id', user.id)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        businessId = (biz as any)?.id ? String((biz as any).id) : null;
      }
    }

    if (!businessId) {
      return NextResponse.json({ error: 'No business found for user.' }, { status: 400 });
    }

    // Ensure "uncategorized" exists for this business (tx_categories).
    const uncName = 'uncategorized';
    let uncTxCatId: string | null = null;
    const unc = await admin
      .from('tx_categories')
      .select('id,name')
      .eq('business_id', businessId)
      .ilike('name', uncName)
      .limit(1)
      .maybeSingle();
    if (!unc.error && (unc.data as any)?.id) {
      uncTxCatId = String((unc.data as any).id);
    } else {
      const ins = await admin
        .from('tx_categories')
        .insert({ business_id: businessId, name: uncName } as any)
        .select('id')
        .single();
      if (ins.error)
        return NextResponse.json({ error: ins.error.message ?? 'Failed to create tx category.' }, { status: 500 });
      uncTxCatId = String((ins.data as any)?.id ?? '');
    }

    // Ensure a mock bank account exists.
    const accountId = `mock_primary`;
    const acct = await admin
      .from('bank_accounts')
      .upsert(
        {
          business_id: businessId,
          provider: 'mock',
          provider_account_id: accountId,
          name: 'Mock Checking',
          mask: '0000',
          currency: 'USD',
        } as any,
        { onConflict: 'business_id,provider,provider_account_id' }
      )
      .select('id')
      .maybeSingle();
    if (acct.error || !(acct.data as any)?.id) {
      return NextResponse.json({ error: acct.error?.message ?? 'Failed to ensure bank account.' }, { status: 500 });
    }
    const bankAccountId = String((acct.data as any).id);

    // Load merchant rules (prefer tx_category_id; fall back to legacy category_id if needed).
    const rulesRes = await admin
      .from('merchant_rules')
      .select('merchant_key,tx_category_id,category_id,active')
      .eq('business_id', businessId)
      .eq('active', true);
    const rules = ((rulesRes.data as any[]) ?? []).reduce((acc, r) => {
      const k = normMerchantKey(String(r.merchant_key ?? ''));
      const v = r.tx_category_id ? String(r.tx_category_id) : r.category_id ? String(r.category_id) : '';
      if (k && v) acc[k] = v;
      return acc;
    }, {} as Record<string, string>);

    const seed = `${businessId}:${user.id}`;
    const txs = makeMockTransactions(seed);

    const rows = txs.map((t) => {
      const key = normMerchantKey(t.merchant_name);
      const ruleCat = key && rules[key] ? rules[key] : null;
      const txCategoryId = ruleCat ?? uncTxCatId;
      const usedRule = Boolean(ruleCat);
      return {
        business_id: businessId,
        bank_account_id: bankAccountId,
        provider: 'mock',
        provider_transaction_id: t.provider_transaction_id,
        provider_tx_id: t.provider_transaction_id,
        posted_at: t.posted_at,
        amount: t.amount,
        amount_cents: Math.round(Number(t.amount) * 100),
        currency: t.currency,
        merchant_name: t.merchant_name,
        description: t.description,
        // Keep legacy category_id null; Phase 1 Stripe FC uses tx_categories.
        tx_category_id: txCategoryId,
        category_source: usedRule ? 'rule' : 'default',
        confidence: usedRule ? 0.9 : 0.2,
        needs_review: usedRule ? false : true,
      };
    });

    const inserted = await admin
      .from('bank_transactions')
      .upsert(rows as any, { onConflict: 'business_id,provider,provider_transaction_id' });
    if (inserted.error) {
      return NextResponse.json({ error: inserted.error.message ?? 'Failed to import transactions.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, imported: rows.length });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('BANK_IMPORT_ERROR', e);
    return NextResponse.json({ error: String(e?.message ?? 'Unexpected error') }, { status: 500 });
  }
}


