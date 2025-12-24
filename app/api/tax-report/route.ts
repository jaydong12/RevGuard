import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireActiveSubscription } from '../../../lib/requireActiveSubscription';
import { computeTaxReport, type PayrollRunRow, type TransactionRow } from '../../../lib/taxEngine';
import { sumBuckets } from '../../../lib/taxBuckets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization') ?? '';
  return authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : null;
}

function isMissingTableOrColumnError(err: any): boolean {
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? '').toLowerCase();
  // Postgres: 42P01 undefined_table; PostgREST: PGRST204 schema cache miss
  // Some environments surface missing table as PGRST205; treat as optional too.
  return (
    code === '42P01' ||
    code === 'PGRST204' ||
    code === 'PGRST205' ||
    msg.includes('does not exist')
  );
}

async function fetchAllRowsPaged(params: {
  supabase: any;
  table: string;
  select?: string;
  filters?: (q: any) => any;
  order?: { column: string; ascending: boolean };
  pageSize?: number;
}) {
  const pageSize = params.pageSize ?? 1000;
  let from = 0;
  const all: any[] = [];

  while (true) {
    let q = params.supabase.from(params.table).select(params.select ?? '*');
    if (params.filters) q = params.filters(q);
    if (params.order) q = q.order(params.order.column, { ascending: params.order.ascending });
    const res = await q.range(from, from + pageSize - 1);
    if (res.error) throw res.error;
    all.push(...(res.data ?? []));
    if (!res.data || res.data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseQueryParams(url: URL) {
  const startDate = url.searchParams.get('startDate') ?? url.searchParams.get('from');
  const endDate = url.searchParams.get('endDate') ?? url.searchParams.get('to');
  const businessId = url.searchParams.get('businessId');
  return {
    startDate: isIsoDate(startDate) ? startDate : null,
    endDate: isIsoDate(endDate) ? endDate : null,
    businessId: businessId ? String(businessId) : null,
  };
}

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function clamp100(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function computeAccuracyForUi(txs: any[]) {
  if (!txs.length) {
    return {
      score: 20,
      sentence: 'Add more transactions so the estimate can learn your patterns.',
      checklist: ['Add transactions (at least a month)'],
    };
  }

  let taxCatCount = 0;
  let catCount = 0;
  let confCount = 0;
  let confSum = 0;

  for (const tx of txs) {
    const taxCat = String((tx as any)?.tax_category ?? '').trim();
    if (taxCat) taxCatCount += 1;

    const cat = String((tx as any)?.category ?? '').trim();
    if (cat && cat.toLowerCase() !== 'uncategorized') catCount += 1;

    const c = Number((tx as any)?.confidence_score);
    if (Number.isFinite(c)) {
      confCount += 1;
      confSum += clamp01(c);
    }
  }

  const taxCatCoverage = taxCatCount / txs.length;
  const categoryCoverage = catCount / txs.length;
  const avgConfidence = confCount ? confSum / confCount : 0.5;

  const score = clamp100(40 * taxCatCoverage + 20 * categoryCoverage + 40 * avgConfidence);

  const sentence =
    score >= 85
      ? 'This estimate is in great shape—just keep classifications up to date.'
      : score >= 65
        ? 'This is directionally solid. A few cleanups will tighten it up.'
        : 'This is a rough estimate right now. A bit of setup will improve it fast.';

  const checklist: string[] = [];
  if (taxCatCoverage < 0.9) checklist.push('Mark more transactions with the right tax category');
  if (categoryCoverage < 0.9) checklist.push('Reduce “Uncategorized” and add clearer categories');
  if (avgConfidence < 0.75) checklist.push('Review low-confidence items and correct mislabels');
  if (!checklist.length) checklist.push('Keep categories and tax tags current each week');

  return { score, sentence, checklist: checklist.slice(0, 3) };
}

function isoTodayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function pickNextPayment(report: any) {
  const plan = Array.isArray(report?.quarterly_plan) ? report.quarterly_plan : [];
  const today = isoTodayUtc();
  const next = plan.find((p: any) => String(p?.due_date ?? '') >= today) ?? plan[0] ?? null;
  return {
    amount: Number(next?.amount) || 0,
    dueDate: String(next?.due_date ?? ''),
  };
}

async function handle(req: Request, body: any) {
  const gate = await requireActiveSubscription(req);
  if (!(gate as any)?.ok) return gate as any;

  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );

  const startDate = body?.startDate ?? body?.from ?? null;
  const endDate = body?.endDate ?? body?.to ?? null;

  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    return NextResponse.json(
      { error: 'Invalid date range. Use startDate/endDate as YYYY-MM-DD.' },
      { status: 400 }
    );
  }

  if (endDate < startDate) {
    return NextResponse.json(
      { error: 'Invalid date range. endDate must be on or after startDate.' },
      { status: 400 }
    );
  }

  const from = startDate;
  const to = endDate;
  const year = Number(String(from).slice(0, 4)) || new Date().getUTCFullYear();

  const requestedBusinessId = typeof body?.businessId === 'string' ? body.businessId : null;

  // Resolve business row (owner-scoped via RLS)
  const bizQ = supabase
    .from('business')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(1);

  const { data: biz, error: bizErr } = requestedBusinessId
    ? await bizQ.eq('id', requestedBusinessId).maybeSingle()
    : await bizQ.maybeSingle();

  if (bizErr || !biz?.id) {
    return NextResponse.json(
      { error: 'No business found for this account.' },
      { status: 404 }
    );
  }

  const businessId = String(biz.id);

  // Load tax settings if table exists; otherwise fall back to business columns.
  let taxSettings: any = null;
  try {
    const res = await supabase
      .from('tax_settings')
      .select('*')
      .eq('business_id', businessId)
      .maybeSingle();
    if (res.error) throw res.error;
    taxSettings = res.data ?? null;
  } catch (err: any) {
    if (!isMissingTableOrColumnError(err)) {
      return NextResponse.json(
        {
          error: 'Failed to load tax settings.',
          details: { code: err?.code ?? null, message: err?.message ?? String(err) },
        },
        { status: 500 }
      );
    }
    taxSettings = null;
  }

  // Load transactions for the period (paged)
  let transactions: TransactionRow[] = [];
  try {
    const rows = await fetchAllRowsPaged({
      supabase,
      table: 'transactions',
      select: '*',
      filters: (q) =>
        q.eq('business_id', businessId).gte('date', from).lte('date', to),
      order: { column: 'date', ascending: false },
    });
    transactions = rows as any;
  } catch (err: any) {
    // If table or columns are missing in some environments, return a useful error.
    return NextResponse.json(
      {
        error: 'Failed to load transactions for tax report.',
        details: { code: err?.code ?? null, message: err?.message ?? String(err) },
      },
      { status: 500 }
    );
  }

  // Provide a simple net profit computed from transactions (keeps UI consistent even if tax engine excludes some items).
  const bucketed = sumBuckets(
    (transactions as any[]).map((t) => ({
      amount: Number((t as any)?.amount) || 0,
      date: (t as any)?.date ?? null,
      category: (t as any)?.category ?? null,
      description: (t as any)?.description ?? null,
      tax_category: String((t as any)?.tax_category ?? '') || null,
      confidence_score: Number((t as any)?.confidence_score) || null,
    }))
  );
  const b = bucketed.totals;

  // Profit from transactions with exclusions:
  // - exclude sales tax (collected/paid)
  // - exclude transfers
  // - exclude loan principal
  // - exclude owner draws and capex (not operating profit)
  const incomeIncluded =
    Math.max(0, b.gross_receipts || 0) + Math.max(0, b.uncategorized || 0);
  const expensesIncluded =
    Math.abs(Math.min(0, b.deductible_expense || 0)) +
    Math.abs(Math.min(0, b.non_deductible_expense || 0)) +
    Math.abs(Math.min(0, b.loan_interest || 0)) +
    Math.abs(Math.min(0, b.payroll_wages || 0)) +
    Math.abs(Math.min(0, b.payroll_taxes || 0)) +
    Math.abs(Math.min(0, b.uncategorized || 0));
  const netProfit = incomeIncluded - expensesIncluded;

  // Load payroll runs if table exists; otherwise treat as empty.
  let payrollRuns: PayrollRunRow[] = [];
  let payrollMissing = false;
  try {
    const rows = await fetchAllRowsPaged({
      supabase,
      table: 'payroll_runs',
      select: '*',
      filters: (q) => q.eq('business_id', businessId).gte('run_date', from).lte('run_date', to),
      order: { column: 'run_date', ascending: false },
    });
    payrollRuns = rows as any;
  } catch (err: any) {
    if (!isMissingTableOrColumnError(err)) {
      return NextResponse.json(
        {
          error: 'Failed to load payroll runs for tax report.',
          details: { code: err?.code ?? null, message: err?.message ?? String(err) },
        },
        { status: 500 }
      );
    }
    payrollRuns = [];
    payrollMissing = true;
  }

  const businessForEngine = {
    ...(biz as any),
    tax_entity_type:
      (taxSettings?.entity_type as any) ??
      (biz as any)?.tax_entity_type ??
      ((biz as any)?.legal_structure as any) ??
      null,
    tax_filing_status:
      (taxSettings?.filing_status as any) ?? (biz as any)?.tax_filing_status ?? null,
    tax_state_rate:
      taxSettings?.state_rate === null || taxSettings?.state_rate === undefined
        ? (biz as any)?.tax_state_rate ?? null
        : Number(taxSettings?.state_rate),
    tax_include_self_employment:
      taxSettings?.include_self_employment === null ||
      taxSettings?.include_self_employment === undefined
        ? (biz as any)?.tax_include_self_employment ?? true
        : Boolean(taxSettings?.include_self_employment),
    // toggles for new UI (may exist on business)
    legal_structure: (biz as any)?.legal_structure ?? null,
    state_code: (biz as any)?.state_code ?? null,
    has_payroll: (biz as any)?.has_payroll ?? false,
    sells_taxable_goods_services: (biz as any)?.sells_taxable_goods_services ?? false,
  };

  const report = computeTaxReport({
    business: businessForEngine as any,
    transactions,
    payrollRuns,
    period: { from, to, year },
  });

  const accuracy = computeAccuracyForUi(transactions as any[]);
  if (bucketed.uncategorizedCount > 0) {
    const checklist = Array.isArray((accuracy as any)?.checklist) ? (accuracy as any).checklist : [];
    const fix = 'Fix uncategorized transactions (so totals match reality)';
    if (!checklist.includes(fix)) checklist.unshift(fix);
    (accuracy as any).checklist = checklist.slice(0, 4);
    // Penalize score for uncategorized rows
    const penalty = Math.min(25, (bucketed.uncategorizedCount / Math.max(1, bucketed.totalCount)) * 40);
    (accuracy as any).score = clamp100(Number((accuracy as any).score ?? 0) - penalty);
  }
  if (payrollMissing) {
    const checklist = Array.isArray((accuracy as any)?.checklist) ? (accuracy as any).checklist : [];
    const fix = 'Create/connect payroll (so payroll taxes can be included)';
    if (!checklist.includes(fix)) checklist.push(fix);
    (accuracy as any).checklist = checklist.slice(0, 4);
  }
  const nextPayment = pickNextPayment(report as any);

  // Breakdown totals must come only from summed transactions (bucket sums).
  const deductibleForTaxableProfit =
    Math.abs(Math.min(0, b.deductible_expense || 0)) +
    Math.abs(Math.min(0, b.payroll_wages || 0)) +
    Math.abs(Math.min(0, b.payroll_taxes || 0)) +
    Math.abs(Math.min(0, b.loan_interest || 0)) +
    Math.abs(Math.min(0, b.uncategorized || 0));

  const taxableProfit =
    incomeIncluded -
    deductibleForTaxableProfit;
  const taxesOwed = Number((report as any)?.estimates?.total_estimated_tax) || 0;
  const setAsidePct = taxableProfit > 0 ? clamp01(taxesOwed / taxableProfit) : null;

  const reconciliationNotes: string[] = [];
  const r1 = Math.abs(netProfit - (incomeIncluded - expensesIncluded));
  if (r1 > 0.01) {
    reconciliationNotes.push(`Profit mismatch: ${r1.toFixed(2)}`);
  }
  const r2 = Math.abs(taxableProfit - (incomeIncluded - deductibleForTaxableProfit));
  if (r2 > 0.01) {
    reconciliationNotes.push(`Taxable profit mismatch: ${r2.toFixed(2)}`);
  }

  return NextResponse.json({
    simpleCards: {
      taxSetAside: { amount: taxesOwed, pct: setAsidePct },
      estimatedTaxesOwedYtd: taxesOwed,
      profitYtd: netProfit,
      nextEstimatedPayment: { amount: nextPayment.amount, dueDate: nextPayment.dueDate },
    },
    breakdown: {
      meta: { transactionCount: (transactions as any[])?.length ?? 0 },
      income: {
        grossIncome: Math.max(0, b.gross_receipts || 0) + Math.max(0, b.uncategorized || 0),
        nonTaxableIncome: Math.abs(b.transfer || 0) + Math.abs(b.loan_principal || 0),
        taxableIncome: incomeIncluded,
      },
      writeOffs: {
        deductibleExpenses: deductibleForTaxableProfit,
        nonDeductibleExpenses: Math.abs(Math.min(0, b.non_deductible_expense || 0)),
        standardDeduction: Number((report as any)?.meta?.standard_deduction) || 0,
        seHalfDeduction: Number((report as any)?.meta?.se_half_deduction) || 0,
      },
      profit: {
        netProfit,
        taxableProfit,
      },
      taxes: {
        federal: Number((report as any)?.estimates?.federal_income_tax) || 0,
        state: Number((report as any)?.estimates?.state_income_tax) || 0,
        selfEmployment: Number((report as any)?.estimates?.self_employment_tax) || 0,
        payrollEmployer: Number((report as any)?.estimates?.employer_payroll_taxes) || 0,
        salesTaxLiability:
          Math.max(0, b.sales_tax_collected || 0) - Math.abs(Math.min(0, b.sales_tax_paid || 0)),
        total: taxesOwed,
      },
      excluded: {
        salesTaxCollected: Math.max(0, b.sales_tax_collected || 0),
        salesTaxPaid: Math.abs(Math.min(0, b.sales_tax_paid || 0)),
        transfers: Math.abs(b.transfer || 0),
        loanPrincipal: Math.abs(b.loan_principal || 0),
        capex: Math.abs(Math.min(0, b.capex || 0)),
        ownerDraw: Math.abs(Math.min(0, b.owner_draw || 0)),
      },
    },
    accuracy,
    nextPayment,
    reconciliation: {
      ok: reconciliationNotes.length === 0,
      notes: reconciliationNotes.length
        ? reconciliationNotes
        : ['Breakdown totals are computed from bucketed transaction sums for this business/date range.'],
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const qp = parseQueryParams(url);
  return await handle(request, {
    startDate: qp.startDate ?? undefined,
    endDate: qp.endDate ?? undefined,
    businessId: qp.businessId ?? undefined,
  });
}

export async function POST(request: Request) {
  let body: any = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  return await handle(request, body ?? {});
}


