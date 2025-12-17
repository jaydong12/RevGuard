import React from 'react';
import { createClient } from '@supabase/supabase-js';
import AutoPrint from './AutoPrint';
import ManualPrintButton from './ManualPrintButton';
import { computeStatements } from '../../../lib/financialStatements';

type Tx = {
  id: number;
  date: string;
  amount: number;
  category?: string | null;
  description?: string | null;
  business_id?: string | null;
  customer_id?: string | null;
  customers?: { name?: string | null } | null;
  tax_category?: string | null;
  tax_status?: string | null;
  tax_year?: number | null;
};

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmt(n: number) {
  const rounded = Math.round(Number(n) || 0);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}$${Math.abs(rounded).toLocaleString('en-US')}`;
}

function groupSum<T>(items: T[], keyFn: (t: T) => string, amtFn: (t: T) => number) {
  const map = new Map<string, number>();
  for (const it of items) {
    const k = keyFn(it);
    map.set(k, (map.get(k) ?? 0) + amtFn(it));
  }
  return Array.from(map.entries()).map(([key, value]) => ({ key, value }));
}

export default async function ReportsPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const report = String(sp.report ?? 'pnl');
  const businessId = String(sp.businessId ?? '');
  const start = String(sp.start ?? '');
  const end = String(sp.end ?? '');
  const basis = String(sp.basis ?? 'cash');

  const validIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!businessId || !validIso(start) || !validIso(end) || end < start) {
    return (
      <div id="report-print" className="report-print">
        <div style={{ padding: 24 }}>
          <h1>Report print view</h1>
          <p>Missing/invalid parameters. Open this view from Reports → Print / Export PDF.</p>
        </div>
      </div>
    );
  }

  const endExclusive = addDays(end, 1);
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const selectWithTax =
    'id,date,amount,category,description,business_id,customer_id,tax_category,tax_status,tax_year,customers(name)';
  const selectWithoutTax =
    'id,date,amount,category,description,business_id,customer_id,customers(name)';

  let res = await supabase
    .from('transactions')
    .select(selectWithTax)
    .eq('business_id', businessId)
    .gte('date', start)
    .lt('date', endExclusive)
    .order('date', { ascending: false });

  if (res.error) {
    const msg = String((res.error as any)?.message ?? '');
    if (msg.includes('tax_category') || msg.includes('tax_status') || msg.includes('tax_year')) {
      res = await supabase
        .from('transactions')
        .select(selectWithoutTax)
        .eq('business_id', businessId)
        .gte('date', start)
        .lt('date', endExclusive)
        .order('date', { ascending: false });
    }
  }

  if (res.error) {
    return (
      <div id="report-print" className="report-print">
        <div style={{ padding: 24 }}>
          <h1>Failed to load report</h1>
          <pre>{String((res.error as any)?.message ?? res.error)}</pre>
        </div>
      </div>
    );
  }

  const txs = ((res.data as any[]) ?? []).map((t) => ({ ...t, amount: +t.amount })) as Tx[];
  const titleMap: Record<string, string> = {
    pnl: 'Profit & Loss',
    balance: 'Balance Sheet',
    cashflow: 'Cash Flow',
    sales_by_customer: 'Sales by Customer',
    expenses_by_vendor: 'Expenses by Vendor',
    tax_summary: 'Tax Summary',
  };

  const statements = computeStatements(txs as any);
  const header = (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{titleMap[report] ?? 'Report'}</div>
      <div style={{ fontSize: 12, marginTop: 4 }}>
        Business: {businessId} • Period: {start} → {end} • Basis: {basis}
      </div>
    </div>
  );

  const pnlTable = () => {
    const rows = groupSum(
      txs,
      (t) => String((t.category || 'Uncategorized').trim() || 'Uncategorized'),
      (t) => Number(t.amount) || 0
    )
      .map((r) => ({ category: r.key, net: r.value }))
      .sort((a, b) => b.net - a.net)
      .slice(0, 50);
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '6px' }}>
              Category
            </th>
            <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '6px' }}>
              Net
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.category}>
              <td style={{ padding: '6px', borderBottom: '1px solid #eee' }}>{r.category}</td>
              <td style={{ padding: '6px', borderBottom: '1px solid #eee', textAlign: 'right' }}>
                {fmt(r.net)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const salesByCustomerTable = () => {
    const income = txs.filter((t) => (Number(t.amount) || 0) > 0);
    const rows = groupSum(
      income,
      (t) => (t.customer_id ? String(t.customer_id) : '__null__'),
      (t) => Number(t.amount) || 0
    )
      .map((r) => {
        const sample = income.find((t) =>
          (t.customer_id ? String(t.customer_id) : '__null__') === r.key
        );
        const name =
          r.key === '__null__'
            ? 'Unknown Customer (Needs Review)'
            : sample?.customers?.name || `Customer ${r.key.slice(0, 8)}`;
        return { key: r.key, name, amount: r.value };
      })
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 100);
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '6px' }}>
              Customer
            </th>
            <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '6px' }}>
              Spend
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td style={{ padding: '6px', borderBottom: '1px solid #eee' }}>{r.name}</td>
              <td style={{ padding: '6px', borderBottom: '1px solid #eee', textAlign: 'right' }}>
                {fmt(r.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const expensesByVendorTable = () => {
    const out = txs.filter((t) => (Number(t.amount) || 0) < 0);
    const rows = groupSum(
      out,
      (t) => String((t.description || 'Unknown vendor').trim() || 'Unknown vendor'),
      (t) => Math.abs(Number(t.amount) || 0)
    )
      .sort((a, b) => b.value - a.value)
      .slice(0, 100);
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '6px' }}>
              Vendor (best-effort)
            </th>
            <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '6px' }}>
              Spend
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td style={{ padding: '6px', borderBottom: '1px solid #eee' }}>{r.key}</td>
              <td style={{ padding: '6px', borderBottom: '1px solid #eee', textAlign: 'right' }}>
                {fmt(-r.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const taxSummaryTable = () => {
    const rows = groupSum(
      txs,
      (t) => String((t.category || 'Uncategorized').trim() || 'Uncategorized'),
      () => 1
    ).map((r) => r.key);

    const byCat = rows.map((cat) => {
      const inTaxable = txs
        .filter((t) => String((t.category || 'Uncategorized').trim() || 'Uncategorized') === cat)
        .filter((t) => (Number(t.amount) || 0) > 0 && String(t.tax_category || 'taxable') === 'taxable')
        .reduce((s, t) => s + (Number(t.amount) || 0), 0);
      const outDed = txs
        .filter((t) => String((t.category || 'Uncategorized').trim() || 'Uncategorized') === cat)
        .filter((t) => (Number(t.amount) || 0) < 0 && String(t.tax_category || '') === 'deductible')
        .reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
      return { category: cat, taxableIncome: inTaxable, deductibleExpenses: outDed, netTaxable: inTaxable - outDed };
    });

    byCat.sort((a, b) => b.netTaxable - a.netTaxable);

    return (
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '6px' }}>
              Category
            </th>
            <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '6px' }}>
              Taxable income
            </th>
            <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '6px' }}>
              Deductible expenses
            </th>
            <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '6px' }}>
              Net taxable
            </th>
          </tr>
        </thead>
        <tbody>
          {byCat.slice(0, 100).map((r) => (
            <tr key={r.category}>
              <td style={{ padding: '6px', borderBottom: '1px solid #eee' }}>{r.category}</td>
              <td style={{ padding: '6px', borderBottom: '1px solid #eee', textAlign: 'right' }}>
                {fmt(r.taxableIncome)}
              </td>
              <td style={{ padding: '6px', borderBottom: '1px solid #eee', textAlign: 'right' }}>
                {fmt(-r.deductibleExpenses)}
              </td>
              <td style={{ padding: '6px', borderBottom: '1px solid #eee', textAlign: 'right' }}>
                {fmt(r.netTaxable)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const body =
    report === 'pnl'
      ? pnlTable()
      : report === 'balance'
        ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={{ padding: '6px', borderBottom: '1px solid #eee' }}>Assets</td>
                  <td style={{ padding: '6px', borderBottom: '1px solid #eee', textAlign: 'right' }}>
                    {fmt(statements.balanceSheet.assets)}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '6px', borderBottom: '1px solid #eee' }}>Liabilities</td>
                  <td style={{ padding: '6px', borderBottom: '1px solid #eee', textAlign: 'right' }}>
                    {fmt(statements.balanceSheet.liabilities)}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '6px', borderBottom: '1px solid #eee' }}>Equity</td>
                  <td style={{ padding: '6px', borderBottom: '1px solid #eee', textAlign: 'right' }}>
                    {fmt(statements.balanceSheet.equity)}
                  </td>
                </tr>
              </tbody>
            </table>
          )
        : report === 'cashflow'
          ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {[
                    ['Operating', statements.cashFlow.operating],
                    ['Investing', statements.cashFlow.investing],
                    ['Financing', statements.cashFlow.financing],
                    ['Net change', statements.cashFlow.netChange],
                  ].map(([label, value]) => (
                    <tr key={String(label)}>
                      <td style={{ padding: '6px', borderBottom: '1px solid #eee' }}>{label}</td>
                      <td style={{ padding: '6px', borderBottom: '1px solid #eee', textAlign: 'right' }}>
                        {fmt(Number(value))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          : report === 'sales_by_customer'
            ? salesByCustomerTable()
            : report === 'expenses_by_vendor'
              ? expensesByVendorTable()
              : report === 'tax_summary'
                ? taxSummaryTable()
                : pnlTable();

  return (
    <div id="report-print" className="report-print" style={{ padding: 24 }}>
      {/* Auto open print dialog for PDF export workflows */}
      <AutoPrint />
      {/* Fallback manual print button (hidden in print) */}
      <ManualPrintButton />
      {header}
      {body}
      <div style={{ marginTop: 18, fontSize: 11, color: '#444' }}>
        Generated from server-fetched data. Charts are intentionally omitted for reliable PDF output.
      </div>
    </div>
  );
}


