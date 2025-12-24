import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireActiveSubscription } from '../../../lib/requireActiveSubscription';
import { computeTaxReport, type PayrollRunRow, type TransactionRow } from '../../../lib/taxEngine';

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
  return code === '42P01' || code === 'PGRST204' || msg.includes('does not exist');
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
  const year = Number(url.searchParams.get('year') ?? '') || null;
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const businessId = url.searchParams.get('businessId');
  return {
    year,
    from: isIsoDate(from) ? from : null,
    to: isIsoDate(to) ? to : null,
    businessId: businessId ? String(businessId) : null,
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

  const now = new Date();
  const year = Number(body?.year) || now.getUTCFullYear();
  const defaultFrom = `${year}-01-01`;
  const defaultTo =
    year === now.getUTCFullYear() ? now.toISOString().slice(0, 10) : `${year}-12-31`;

  const from = isIsoDate(body?.from) ? body.from : defaultFrom;
  const to = isIsoDate(body?.to) ? body.to : defaultTo;

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

  // Load payroll runs if table exists; otherwise treat as empty.
  let payrollRuns: PayrollRunRow[] = [];
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
  }

  const report = computeTaxReport({
    business: biz as any,
    transactions,
    payrollRuns,
    period: { from, to, year },
  });

  return NextResponse.json(report);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const qp = parseQueryParams(url);
  return await handle(request, {
    year: qp.year ?? undefined,
    from: qp.from ?? undefined,
    to: qp.to ?? undefined,
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


