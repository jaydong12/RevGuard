'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ReportLayout } from '../../components/ReportLayout';
import { supabase } from '../../utils/supabaseClient';
import { formatCurrency } from '../../lib/formatCurrency';
import { computeStatements } from '../../lib/financialStatements';
import { useQueryClient } from '@tanstack/react-query';
import { useAppData } from '../../components/AppDataProvider';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Cell,
  Line,
  LabelList,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { PremiumBarChart } from '../../components/PremiumBarChart';

function ChartFrame({
  children,
  minHeight = 320,
  className = 'w-full h-[320px]',
}: {
  children: React.ReactNode;
  minHeight?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const r = el.getBoundingClientRect();
      setReady(r.width > 0 && r.height > 0);
    };

    update();

    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className={className} style={{ minHeight }}>
      {ready ? children : null}
    </div>
  );
}

type Transaction = {
  id: number;
  date: string; // YYYY-MM-DD
  amount: number; // +income, -expense
  category?: string;
  description?: string;
  customer_id?: string | null;
  customers?: { name?: string | null; business_id?: string | null } | null;
  business_id?: string;
  tax_category?: string | null;
  tax_status?: 'not_taxed' | 'taxed' | string | null;
  tax_year?: number | null;
};

type ReportKind =
  | 'pnl'
  | 'balance'
  | 'cashflow'
  | 'sales_by_customer'
  | 'expenses_by_vendor'
  | 'tax_summary';
type ReportCategory = 'Overview' | 'Sales' | 'Expenses' | 'Taxes' | 'Cash';
type Basis = 'cash' | 'accrual';
type Preset = 'this_month' | 'ytd' | 'last_year';

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

function GlassCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={classNames(
        'rounded-2xl border border-slate-800/70 bg-slate-950/50 backdrop-blur-sm shadow-[0_0_0_1px_rgba(148,163,184,0.06)]',
        className
      )}
    >
      {children}
    </div>
  );
}

function Icon({
  name,
  className,
}: {
  name:
    | 'search'
    | 'doc'
    | 'trend'
    | 'balance'
    | 'cash'
    | 'spark'
    | 'share'
    | 'print';
  className?: string;
}) {
  const common = classNames('h-4 w-4', className);
  if (name === 'search') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={common}>
        <path
          d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M16.5 16.5 21 21"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (name === 'trend') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={common}>
        <path
          d="M4 16l6-6 4 4 6-8"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M20 7v5h-5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (name === 'balance') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={common}>
        <path
          d="M12 3v18"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M6 7h12"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M7 7 4 12h6L7 7Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M17 7 14 12h6l-3-5Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (name === 'cash') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={common}>
        <path
          d="M3 7h18v10H3V7Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M7 12h.01M17 12h.01"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M12 10.5c-1 0-1.8.67-1.8 1.5s.8 1.5 1.8 1.5 1.8.67 1.8 1.5-.8 1.5-1.8 1.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (name === 'spark') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={common}>
        <path
          d="M12 2l1.6 5.2L19 9l-5.4 1.8L12 16l-1.6-5.2L5 9l5.4-1.8L12 2Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M4 16l.8 2.6L7 19l-2.2.4L4 22l-.8-2.6L1 19l2.2-.4L4 16Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (name === 'share') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={common}>
        <path
          d="M15 8a3 3 0 1 0-2.83-4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M9 12l6-4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M9 12l6 4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M9 12a3 3 0 1 1-3-3"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M18 20a3 3 0 1 1 0-6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (name === 'print') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={common}>
        <path
          d="M7 8V4h10v4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M7 17v3h10v-3"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M6 10h12a3 3 0 0 1 3 3v4H3v-4a3 3 0 0 1 3-3Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  // doc
  return (
    <svg viewBox="0 0 24 24" fill="none" className={common}>
      <path
        d="M7 3h7l3 3v15H7V3Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M14 3v4h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M9 11h6M9 15h6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

function isIsoDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function formatIsoToMdy(iso: string) {
  if (!isIsoDate(iso)) return '';
  const [yyyy, mm, dd] = iso.split('-');
  return `${mm}/${dd}/${yyyy}`;
}

function parseMdyToIso(raw: string): { iso: string } | { error: string } {
  const str = String(raw || '').trim();
  if (!str) return { error: 'Date is required.' };

  // Accept ISO too (helps paste), but normalize to ISO.
  if (isIsoDate(str)) return { iso: str };

  // Accept MM/DD/YYYY, M/D/YYYY, MM-DD-YYYY, or 8 digits (MMDDYYYY).
  const digitsOnly = str.replace(/[^\d]/g, '');
  let mm: string | null = null;
  let dd: string | null = null;
  let yyyy: string | null = null;

  const mdy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (mdy) {
    mm = mdy[1];
    dd = mdy[2];
    yyyy = mdy[3];
  } else if (digitsOnly.length === 8) {
    mm = digitsOnly.slice(0, 2);
    dd = digitsOnly.slice(2, 4);
    yyyy = digitsOnly.slice(4, 8);
  }

  if (!mm || !dd || !yyyy) {
    return { error: 'Use MM/DD/YYYY.' };
  }

  const month = Number(mm);
  const day = Number(dd);
  const year = Number(yyyy);

  if (!Number.isFinite(month) || month < 1 || month > 12) {
    return { error: 'Month must be 1–12.' };
  }
  if (!Number.isFinite(day) || day < 1 || day > 31) {
    return { error: 'Day must be 1–31.' };
  }
  if (!Number.isFinite(year) || year < 1900 || year > 2100) {
    return { error: 'Year must be 1900–2100.' };
  }

  const d = new Date(Date.UTC(year, month - 1, day));
  // Prevent JS date rollover (e.g. 02/31 -> Mar 02)
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return { error: 'Invalid calendar date.' };
  }

  return { iso: toISODate(d) };
}

function fmtMoneyRounded(value: unknown) {
  const n = Number(value) || 0;
  const rounded = Math.round(n);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}$${Math.abs(rounded).toLocaleString('en-US')}`;
}

function TrendGlassTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: any[];
  label?: any;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row: Record<string, number> = {};
  for (const p of payload) {
    const k = String(p?.dataKey ?? p?.name ?? '');
    if (!k) continue;
    row[k] = Number(p?.value) || 0;
  }
  const income = row.income ?? 0;
  const expenses = row.expenses ?? 0;
  const net = row.net ?? 0;

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-950/70 backdrop-blur px-3 py-2 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
      <div className="text-[11px] text-slate-400">{String(label ?? '')}</div>
      <div className="mt-1 grid gap-1 text-[11px]">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">Income</span>
          <span className="font-semibold text-emerald-200">{fmtMoneyRounded(income)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">Expenses</span>
          <span className="font-semibold text-rose-200">{fmtMoneyRounded(-expenses)}</span>
        </div>
        <div className="h-px bg-slate-800 my-1" />
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">Net</span>
          <span className="font-semibold text-slate-100">{fmtMoneyRounded(net)}</span>
        </div>
      </div>
    </div>
  );
}

function startOfMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function startOfYear(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
}

function getPresetRange(now: Date, preset: Preset) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (preset === 'this_month') {
    return { start: toISODate(startOfMonth(today)), end: toISODate(today) };
  }
  if (preset === 'last_year') {
    const y = today.getUTCFullYear() - 1;
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
  // ytd
  return { start: toISODate(startOfYear(today)), end: toISODate(today) };
}

async function fetchTransactionsByRange(params: {
  businessId: string;
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD exclusive
}) {
  const { businessId, start, end } = params;
  const pageSize = 1000;
  let from = 0;
  const all: any[] = [];

  while (true) {
    const selectWithTax =
      'id,date,amount,category,description,business_id,customer_id,tax_category,tax_status,tax_year,customers(name,business_id)';
    const selectWithoutTax =
      'id,date,amount,category,description,business_id,customer_id,customers(name,business_id)';

    let res: any = await supabase
      .from('transactions')
      // Include customer_id and a joined customer name when possible.
      // The join works when the FK relationship exists in Supabase schema.
      .select(selectWithTax)
      .eq('business_id', businessId)
      .gte('date', start)
      .lt('date', end)
      .order('date', { ascending: false })
      .range(from, from + pageSize - 1);

    if (res.error) {
      // Graceful fallback if migrations haven't been applied yet.
      const msg = String((res.error as any)?.message ?? '');
      if (msg.includes('tax_category') || msg.includes('tax_status') || msg.includes('tax_year')) {
        res = await supabase
          .from('transactions')
          .select(selectWithoutTax)
          .eq('business_id', businessId)
          .gte('date', start)
          .lt('date', end)
          .order('date', { ascending: false })
          .range(from, from + pageSize - 1);
      }
    }

    if (res.error) throw res.error;

    const batch = (res.data as any[]) ?? [];
    all.push(...batch);

    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return all.map((tx) => ({ ...tx, amount: +tx.amount })) as Transaction[];
}

async function fetchUnassignedRevenueTxsPage(params: {
  businessId: string;
  start: string; // YYYY-MM-DD inclusive
  endExclusive: string; // YYYY-MM-DD exclusive
  offset: number;
  limit: number;
}) {
  const { businessId, start, endExclusive, offset, limit } = params;

  const selectWithTax =
    'id,date,amount,description,category,business_id,customer_id,tax_category,tax_status,tax_year';
  const selectWithoutTax = 'id,date,amount,description,category,business_id,customer_id';

  let res: any = await supabase
    .from('transactions')
    .select(selectWithTax, { count: 'exact' })
    .eq('business_id', businessId)
    .gte('date', start)
    .lt('date', endExclusive)
    .gt('amount', 0)
    .is('customer_id', null)
    .order('date', { ascending: false })
    .range(offset, offset + limit - 1);

  if (res.error) {
    const msg = String((res.error as any)?.message ?? '');
    if (msg.includes('tax_category') || msg.includes('tax_status') || msg.includes('tax_year')) {
      res = await supabase
        .from('transactions')
        .select(selectWithoutTax, { count: 'exact' })
        .eq('business_id', businessId)
        .gte('date', start)
        .lt('date', endExclusive)
        .gt('amount', 0)
        .is('customer_id', null)
        .order('date', { ascending: false })
        .range(offset, offset + limit - 1);
    }
  }

  if (res.error) throw res.error;

  return {
    rows: ((res.data as any[]) ?? []).map((tx) => ({ ...tx, amount: +tx.amount })) as Transaction[],
    total: (res as any).count ?? 0,
  };
}

function buildPnlRows(txs: Transaction[]) {
  const map = new Map<
    string,
    { category: string; income: number; expenses: number; net: number; hint?: string }
  >();

  for (const tx of txs) {
    const rawCat = (tx.category || 'Uncategorized').trim() || 'Uncategorized';
    const cleaned = cleanLabelAndHint(rawCat);
    const cat = cleaned.label;
    if (!map.has(cat)) {
      map.set(cat, { category: cat, income: 0, expenses: 0, net: 0, hint: cleaned.hint });
    }
    const row = map.get(cat)!;
    const amt = Number(tx.amount) || 0;
    if (amt >= 0) row.income += amt;
    else row.expenses += Math.abs(amt);
    row.net = row.income - row.expenses;
  }

  return Array.from(map.values()).sort((a, b) => b.net - a.net);
}

function isLiabilityCategory(cat?: string) {
  if (!cat) return false;
  const c = cat.toLowerCase();
  return (
    c.includes('loan') ||
    c.includes('payable') ||
    c.includes('credit') ||
    c.includes('tax') ||
    c.includes('liab') ||
    c.includes('mortgage') ||
    c.includes('card') ||
    c.includes('overdraft')
  );
}

function isAssetCategory(cat?: string) {
  if (!cat) return false;
  const c = cat.toLowerCase();
  return (
    c.includes('equipment') ||
    c.includes('truck') ||
    c.includes('computer') ||
    c.includes('asset') ||
    c.includes('receivable') ||
    c.includes('cash') ||
    c.includes('bank')
  );
}

function buildBalanceBreakdown(txs: Transaction[]) {
  const assetsByCat = new Map<string, number>();
  const liabsByCat = new Map<string, number>();

  for (const tx of txs) {
    const cat = (tx.category || 'Uncategorized').trim() || 'Uncategorized';
    const amt = Number(tx.amount) || 0;

    if (isAssetCategory(cat)) {
      assetsByCat.set(cat, (assetsByCat.get(cat) ?? 0) + Math.abs(amt));
    }
    if (isLiabilityCategory(cat)) {
      // treat positives as liability increases, negatives as reductions
      const delta = amt > 0 ? amt : Math.abs(amt);
      liabsByCat.set(cat, (liabsByCat.get(cat) ?? 0) + delta);
    }
  }

  const assets = Array.from(assetsByCat.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  const liabilities = Array.from(liabsByCat.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  return { assets, liabilities };
}

function titleCase(input: string) {
  return input
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function normalizeLabelRaw(raw: unknown) {
  const s = raw ? String(raw) : '';
  return s.replace(/\s+/g, ' ').trim();
}

const LABEL_HINTS: Record<string, string> = {
  'Product Sales': 'Money earned from selling products.',
  'Investment Return': 'Income from investments (interest/dividends/gains).',
  Consulting: 'Revenue from consulting services.',
  Services: 'Revenue from services provided.',
  'Owner Investment': 'Money you put into the business.',
  Equipment: 'Spending on equipment/tools.',
  Deposit: 'Money deposited into accounts (verify source).',
  Retainer: 'Upfront client payment for ongoing work.',
  Subscription: 'Recurring revenue from subscriptions.',
};

function cleanLabelAndHint(raw: string) {
  const s = normalizeLabelRaw(raw);
  if (!s) return { label: 'Uncategorized', hint: undefined as string | undefined };
  const lower = s.toLowerCase();

  // Retainer patterns (preserve client name if present)
  const ret = s.match(/retainer.*from\s+(.+)$/i);
  if (ret) {
    const who = normalizeLabelRaw(ret[1]);
    const whoNice = who && who.length <= 60 ? who : 'Client';
    return { label: `Retainer (${whoNice})`, hint: LABEL_HINTS.Retainer };
  }
  if (lower.includes('retainer')) {
    return { label: 'Retainer', hint: LABEL_HINTS.Retainer };
  }

  // Owner investment / capital
  if (
    lower.includes('founder capital') ||
    lower.includes('owner capital') ||
    lower.includes('owner investment') ||
    lower.includes('owner contribution') ||
    lower.includes('capital contribution')
  ) {
    return { label: 'Owner Investment', hint: LABEL_HINTS['Owner Investment'] };
  }

  // Deposits
  if (lower.includes('bank deposit') || lower === 'deposit' || lower.includes('deposit')) {
    return { label: 'Deposit', hint: LABEL_HINTS.Deposit };
  }

  // Equipment purchases
  if (lower.includes('equipment purchase') || lower === 'equipment' || lower.includes('equipment')) {
    return { label: 'Equipment', hint: LABEL_HINTS.Equipment };
  }

  // Consulting
  if (lower.includes('consulting')) {
    return { label: 'Consulting', hint: LABEL_HINTS.Consulting };
  }

  // Subscription(s)
  if (lower.includes('subscription')) {
    return { label: 'Subscription', hint: LABEL_HINTS.Subscription };
  }

  // Services
  if (lower.includes('service') || lower.includes('services')) {
    return { label: 'Services', hint: LABEL_HINTS.Services };
  }

  // Product sales
  if (lower.includes('product sale') || lower.includes('product sales')) {
    return { label: 'Product Sales', hint: LABEL_HINTS['Product Sales'] };
  }

  // Investment return
  if (
    lower.includes('investment return') ||
    lower.includes('interest') ||
    lower.includes('dividend') ||
    lower.includes('capital gain')
  ) {
    return { label: 'Investment Return', hint: LABEL_HINTS['Investment Return'] };
  }

  // Generic cleanup: normalize casing if the string is shouty.
  const shouty = s === s.toUpperCase() && /[A-Z]/.test(s);
  const label = shouty ? titleCase(s) : s;
  return { label, hint: LABEL_HINTS[label] };
}

function getVendorName(tx: Transaction) {
  const anyTx = tx as any;
  const raw = anyTx.vendor_name ?? anyTx.vendor ?? anyTx.merchant ?? anyTx.payee;
  const name = normalizeLabelRaw(raw);
  if (name) return name;
  const desc = normalizeLabelRaw(tx.description);
  return desc || 'Unknown vendor';
}

function isNonRevenueText(text: string) {
  const t = text.toLowerCase();
  return (
    t.includes('transfer') ||
    t.includes('bank transfer') ||
    t.includes('owner') ||
    t.includes('founder') ||
    t.includes('capital') ||
    t.includes('contribution') ||
    t.includes('draw') ||
    t.includes('equity') ||
    t.includes('deposit') ||
    t.includes('loan') ||
    t.includes('credit')
  );
}

function isRevenueText(text: string) {
  const t = text.toLowerCase();
  return (
    t.includes('sale') ||
    t.includes('sales') ||
    t.includes('service') ||
    t.includes('services') ||
    t.includes('consult') ||
    t.includes('retainer') ||
    t.includes('subscription') ||
    t.includes('invoice')
  );
}

function isTrueRevenueLabel(label: string) {
  return (
    label === 'Product Sales' ||
    label === 'Consulting' ||
    label === 'Services' ||
    label.startsWith('Retainer') ||
    label === 'Subscription'
  );
}

function buildSalesByCustomerRows(
  txs: Transaction[],
  customersById: Map<string, string>
) {
  const map = new Map<string, { name: string; amount: number }>();
  let total = 0;

  for (const tx of txs) {
    const amt = Number(tx.amount) || 0;
    // Sales definition for this report: revenue transactions = amount > 0
    if (amt <= 0) continue;

    const customerId = tx.customer_id ? String(tx.customer_id) : '';

    if (!customerId) {
      const key = '__null__';
      const existing = map.get(key);
      if (existing) existing.amount += amt;
      else map.set(key, { name: 'Unknown Customer (Needs Review)', amount: amt });
      total += amt;
      continue;
    }

    // Prefer joined name, then customersById map, then a fallback.
    const joinedBusinessOk =
      tx.customers?.business_id &&
      tx.business_id &&
      String(tx.customers.business_id) === String(tx.business_id);
    const joinedName = joinedBusinessOk
      ? normalizeLabelRaw(tx.customers?.name ?? '')
      : '';
    const fromMap = normalizeLabelRaw(customersById.get(customerId) ?? '');
    const displayName =
      joinedName || fromMap || `Customer ${customerId.slice(0, 8)}`;

    const existing = map.get(customerId);
    if (existing) existing.amount += amt;
    else map.set(customerId, { name: displayName, amount: amt });
    total += amt;
  }

  const rows = Array.from(map.entries())
    .map(([id, v]) => ({
      customer_id: id === '__null__' ? null : id,
      name: v.name,
      amount: v.amount,
      pct: total > 0 ? (v.amount / total) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  return { rows, total };
}

function buildExpensesByVendorRows(txs: Transaction[]) {
  const map = new Map<string, number>();
  let total = 0;
  let usedVendorField = false;

  for (const tx of txs) {
    const amt = Number(tx.amount) || 0;
    if (amt >= 0) continue;
    const anyTx = tx as any;
    if (anyTx.vendor_name || anyTx.vendor || anyTx.merchant || anyTx.payee) {
      usedVendorField = true;
    }
    const key = cleanLabelAndHint(getVendorName(tx)).label;
    const out = Math.abs(amt);
    map.set(key, (map.get(key) ?? 0) + out);
    total += out;
  }

  const rows = Array.from(map.entries())
    .map(([name, amount]) => ({
      name,
      amount,
      pct: total > 0 ? (amount / total) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  return { rows, total, usedVendorField };
}

function buildTaxSummaryRows(txs: Transaction[]) {
  // Placeholder rates (not tax advice). Keep these simple & explicit in the UI.
  const FEDERAL_RATE = 0.24;
  const STATE_RATE = 0.05;

  const nonTaxableIncomeMatchers = [
    'owner investment',
    'owner contribution',
    'capital contribution',
    'founder capital',
    'equity',
    'deposit',
    'bank deposit',
    'loan',
    'credit',
    'transfer',
  ];

  const deductibleMatchers = [
    'advertising',
    'marketing',
    'software',
    'supplies',
    'rent',
    'utilities',
    'payroll',
    'insurance',
    'travel',
    'fees',
    'professional',
    'contractor',
    'office',
  ];

  function taxTreatmentForCategory(cat: string) {
    const c = (cat || '').toLowerCase();

    // Income treatment
    const isNonTaxableIncome = nonTaxableIncomeMatchers.some((m) => c.includes(m));
    if (isNonTaxableIncome) {
      return { label: 'Non-taxable income', hint: 'Likely owner funds, transfers, deposits, or loans.' };
    }

    // Expense treatment
    if (c.includes('meal') || c.includes('meals')) {
      return { label: 'Partially deductible (50%)', hint: 'Meals are often only partially deductible.' };
    }
    if (c.includes('equipment') || c.includes('asset')) {
      return { label: 'Often capitalized', hint: 'Equipment may be capitalized and depreciated (not always fully deductible immediately).' };
    }
    if (c.includes('personal') || c.includes('owner draw') || c.includes('owners draw')) {
      return { label: 'Non-deductible', hint: 'Personal spending / owner draws are generally not deductible business expenses.' };
    }
    if (deductibleMatchers.some((m) => c.includes(m))) {
      return { label: 'Tax-deductible (typical)', hint: 'Common business expense category (verify specifics for your situation).' };
    }

    return { label: 'Review', hint: 'Needs review to confirm whether this is deductible or taxable.' };
  }

  function getTaxStatus(tx: Transaction) {
    return tx.tax_status === 'taxed' ? 'taxed' : 'not_taxed';
  }

  function incomeClassification(tx: Transaction, cleanedCat: string) {
    // Primary source of truth: tax_category field (default is 'taxable').
    const override = String(tx.tax_category || 'taxable').toLowerCase();
    if (override === 'non_taxable') return 'non_taxable' as const;
    return 'taxable' as const;
  }

  function expenseClassification(tx: Transaction, cleanedCat: string) {
    // Optional overrides: allow explicit tax_category values to control deductibility.
    const override = String(tx.tax_category || '').toLowerCase();
    if (override === 'partial_deductible') return 'partial_deductible' as const;
    if (override === 'capitalized') return 'capitalized' as const;
    if (override === 'non_deductible') return 'non_deductible' as const;
    if (override === 'deductible') return 'deductible' as const;

    const t = taxTreatmentForCategory(cleanedCat).label.toLowerCase();
    if (t.includes('partially deductible')) return 'partial_deductible' as const;
    if (t.includes('often capitalized')) return 'capitalized' as const;
    if (t.includes('non-deductible')) return 'non_deductible' as const;
    if (t.includes('tax-deductible')) return 'deductible' as const;
    return 'review' as const;
  }

  const map = new Map<
    string,
    {
      category: string;
      income: number;
      expenses: number;
      net: number;
      treatmentLabel: string;
      treatmentHint: string;
    }
  >();

  // Tax-focused breakdown (driven by explicit tx.tax_category values).
  const taxMap = new Map<
    string,
    {
      category: string;
      taxCategories: Map<string, number>;
      taxableIncome: number;
      deductibleExpenses: number;
    }
  >();

  let totalIncome = 0;
  let totalExpenses = 0;

  let taxableIncome = 0;
  let nonTaxableIncome = 0;
  let deductibleExpenses = 0;
  let nonDeductibleExpenses = 0;

  let taxableIncomeTaxed = 0;
  let taxableIncomeNotTaxed = 0;
  let deductibleExpensesTaxed = 0;
  let deductibleExpensesNotTaxed = 0;

  for (const tx of txs) {
    const rawCat = (tx.category || 'Uncategorized').trim() || 'Uncategorized';
    const cleanedCat = cleanLabelAndHint(rawCat).label;
    if (!map.has(cleanedCat)) {
      const t = taxTreatmentForCategory(cleanedCat);
      map.set(cleanedCat, {
        category: cleanedCat,
        income: 0,
        expenses: 0,
        net: 0,
        treatmentLabel: t.label,
        treatmentHint: t.hint,
      });
    }
    const row = map.get(cleanedCat)!;
    const amt = Number(tx.amount) || 0;

    // Build tax-focused aggregates per category.
    if (!taxMap.has(cleanedCat)) {
      taxMap.set(cleanedCat, {
        category: cleanedCat,
        taxCategories: new Map(),
        taxableIncome: 0,
        deductibleExpenses: 0,
      });
    }
    const tr = taxMap.get(cleanedCat)!;
    const rawTaxCategory = String(tx.tax_category || 'taxable').toLowerCase();
    tr.taxCategories.set(rawTaxCategory, (tr.taxCategories.get(rawTaxCategory) ?? 0) + 1);
    if (amt > 0 && rawTaxCategory === 'taxable') tr.taxableIncome += amt;
    if (amt < 0 && rawTaxCategory === 'deductible') tr.deductibleExpenses += Math.abs(amt);

    if (amt >= 0) {
      row.income += amt;
      totalIncome += amt;

      const cls = incomeClassification(tx, cleanedCat);
      const status = getTaxStatus(tx);
      if (cls === 'non_taxable') {
        nonTaxableIncome += amt;
      } else {
        taxableIncome += amt;
        if (status === 'taxed') taxableIncomeTaxed += amt;
        else taxableIncomeNotTaxed += amt;
      }
    } else {
      const out = Math.abs(amt);
      row.expenses += out;
      totalExpenses += out;

      const cls = expenseClassification(tx, cleanedCat);
      const status = getTaxStatus(tx);
      if (cls === 'partial_deductible') {
        deductibleExpenses += out * 0.5;
        nonDeductibleExpenses += out * 0.5;
        if (status === 'taxed') deductibleExpensesTaxed += out * 0.5;
        else deductibleExpensesNotTaxed += out * 0.5;
      } else if (cls === 'deductible') {
        deductibleExpenses += out;
        if (status === 'taxed') deductibleExpensesTaxed += out;
        else deductibleExpensesNotTaxed += out;
      } else if (cls === 'non_deductible' || cls === 'capitalized') {
        nonDeductibleExpenses += out;
      } else {
        // Unknown: don’t count as deductible until reviewed.
        nonDeductibleExpenses += out;
      }
    }
    row.net = row.income - row.expenses;
  }

  const rows = Array.from(map.values()).sort(
    (a, b) => b.expenses - a.expenses
  );

  // Very simple "tax-ready" heuristic: exclude obvious non-deductible buckets.
  const nonDeductibleMatchers = [
    'owner draw',
    'owners draw',
    'owner',
    'equity',
    'transfer',
    'personal',
  ];

  const taxReadyExpenses = rows.reduce((sum, r) => {
    const lower = r.category.toLowerCase();
    const isNonDeductible = nonDeductibleMatchers.some((m) =>
      lower.includes(m)
    );
    return isNonDeductible ? sum : sum + r.expenses;
  }, 0);

  const rateSum = FEDERAL_RATE + STATE_RATE;
  const estimatedTaxableProfit = Math.max(0, taxableIncome - deductibleExpenses);
  const estimatedTaxableProfitRemaining = Math.max(
    0,
    taxableIncomeNotTaxed - deductibleExpensesNotTaxed
  );

  const estFederal = estimatedTaxableProfit * FEDERAL_RATE;
  const estState = estimatedTaxableProfit * STATE_RATE;
  const estTotal = estimatedTaxableProfit * rateSum;

  const estFederalRemaining = estimatedTaxableProfitRemaining * FEDERAL_RATE;
  const estStateRemaining = estimatedTaxableProfitRemaining * STATE_RATE;
  const estTotalRemaining = estimatedTaxableProfitRemaining * rateSum;

  const taxRows = Array.from(taxMap.values())
    .map((r) => {
      const distinct = Array.from(r.taxCategories.keys()).filter(Boolean);
      const tax_category =
        distinct.length === 1 ? distinct[0] : distinct.length === 0 ? 'taxable' : 'mixed';
      return {
        category: r.category,
        tax_category,
        taxableIncome: r.taxableIncome,
        deductibleExpenses: r.deductibleExpenses,
        netTaxable: r.taxableIncome - r.deductibleExpenses,
      };
    })
    .sort((a, b) => b.netTaxable - a.netTaxable);

  return {
    rows,
    taxRows,
    totalIncome,
    totalExpenses,
    net: totalIncome - totalExpenses,
    taxReadyExpenses,
    taxableIncome,
    nonTaxableIncome,
    deductibleExpenses,
    nonDeductibleExpenses,
    estimatedTaxableProfit,
    estimatedTaxableProfitRemaining,
    estFederal,
    estState,
    estTotal,
    estFederalRemaining,
    estStateRemaining,
    estTotalRemaining,
    taxableIncomeTaxed,
    taxableIncomeNotTaxed,
    deductibleExpensesTaxed,
    deductibleExpensesNotTaxed,
    rates: { federal: FEDERAL_RATE, state: STATE_RATE },
  };
}

function buildMonthlySeries(txs: Transaction[]) {
  const map = new Map<
    string,
    { month: string; label: string; income: number; expenses: number; net: number }
  >();

  for (const tx of txs) {
    const key = (tx.date || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    if (!map.has(key)) {
      const d = new Date(`${key}-01T00:00:00Z`);
      const label = d.toLocaleString('en-US', { month: 'short' });
      map.set(key, { month: key, label, income: 0, expenses: 0, net: 0 });
    }
    const row = map.get(key)!;
    const amt = Number(tx.amount) || 0;
    if (amt >= 0) row.income += amt;
    else row.expenses += Math.abs(amt);
    row.net += amt;
  }

  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
}

const REPORT_LIBRARY: Array<{
  id: string;
  kind: ReportKind;
  title: string;
  description: string;
  category: ReportCategory;
  icon: React.ComponentProps<typeof Icon>['name'];
}> = [
  {
    id: 'pnl',
    kind: 'pnl',
    title: 'Profit & Loss',
    description: 'Income, expenses, and net income with category breakdown.',
    category: 'Overview',
    icon: 'trend',
  },
  {
    id: 'balance',
    kind: 'balance',
    title: 'Balance Sheet',
    description: 'Assets, liabilities, and equity with a simple breakdown.',
    category: 'Overview',
    icon: 'balance',
  },
  {
    id: 'cashflow',
    kind: 'cashflow',
    title: 'Cash Flow',
    description: 'Operating / investing / financing plus net cash change.',
    category: 'Cash',
    icon: 'cash',
  },
  {
    id: 'sales_by_customer',
    kind: 'sales_by_customer',
    title: 'Sales by Customer',
    description:
      'Sales are revenue transactions (amount > 0), grouped by customer_id (missing → Unknown Customer).',
    category: 'Sales',
    icon: 'doc',
  },
  {
    id: 'expenses_by_vendor',
    kind: 'expenses_by_vendor',
    title: 'Expenses by Vendor',
    description: 'Who you’re paying the most and where costs creep in.',
    category: 'Expenses',
    icon: 'doc',
  },
  {
    id: 'tax_summary',
    kind: 'tax_summary',
    title: 'Tax Summary',
    description: 'High-level tax-ready totals and category guidance.',
    category: 'Taxes',
    icon: 'spark',
  },
];

export default function ReportsPage() {
  const perfEnabled = useMemo(() => {
    try {
      return typeof window !== 'undefined' && localStorage.getItem('revguard:perf') === '1';
    } catch {
      return false;
    }
  }, []);
  const queryClient = useQueryClient();
  const {
    businessId: selectedBusinessId,
    userId,
    transactions: allTransactionsRaw,
    customers: customersRaw,
    loading: businessLoading,
    error: businessError,
  } = useAppData();
  const allTransactions = (allTransactionsRaw as any[]) as Transaction[];
  const [activeReportId, setActiveReportId] = useState<string>('pnl');
  const [search, setSearch] = useState('');
  const [basis, setBasis] = useState<Basis>('cash');

  const now = useMemo(() => new Date(), []);
  const defaultRange = useMemo(() => getPresetRange(now, 'ytd'), [now]);
  const [startDate, setStartDate] = useState<string>(defaultRange.start);
  const [endDate, setEndDate] = useState<string>(defaultRange.end);
  const endExclusive = useMemo(() => addDays(endDate, 1), [endDate]);

  // Text inputs are typeable (MM/DD/YYYY) and commit into ISO dates on blur/Enter.
  const [startText, setStartText] = useState<string>(
    formatIsoToMdy(defaultRange.start)
  );
  const [endText, setEndText] = useState<string>(
    formatIsoToMdy(defaultRange.end)
  );

  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone?: 'ok' | 'error' } | null>(
    null
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [trendHoverIndex, setTrendHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    setDetailsOpen(false);
  }, [activeReportId]);

  const loading = businessLoading;
  const customersList = useMemo(() => {
    const rows = (customersRaw as any[]) ?? [];
    return rows.map((row) => ({
      id: String((row as any).id),
      name: String((row as any).name ?? '').trim() || 'Unnamed customer',
      company: String((row as any).company ?? '').trim(),
    }));
  }, [customersRaw]);
  const customersById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customersList) {
      if (c.id) map.set(c.id, c.name || 'Unnamed customer');
    }
    return map;
  }, [customersList]);

  // Transactions for the currently selected report date window.
  const txs = useMemo(() => {
    if (!selectedBusinessId) return [];
    if (!startDate || !endDate) return [];
    if (!isIsoDate(startDate) || !isIsoDate(endDate)) return [];
    if (endDate < startDate) return [];

    const start = startDate;
    const endEx = endExclusive;
    return allTransactions.filter((tx) => {
      if (!tx.date) return false;
      // ISO date comparison is safe for YYYY-MM-DD.
      return tx.date >= start && tx.date < endEx;
    });
  }, [allTransactions, selectedBusinessId, startDate, endDate, endExclusive]);

  // Date validation (no refetch on mount/focus; data is read from cached queries).
  useEffect(() => {
    setError(null);
    if (!selectedBusinessId) return;
    if (!startDate || !endDate) return;
    if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
      setError('Invalid date format. Please use the date pickers.');
      return;
    }
    if (endDate < startDate) {
      setError('End date must be on or after the start date.');
    }
  }, [selectedBusinessId, startDate, endDate]);

  // Basis toggle is fully functional. Until invoices/bills are modeled, Accrual
  // uses the same transactions as Cash — but everything recomputes instantly.
  const effectiveTxs = useMemo(() => txs, [txs, basis]);

  const statements = useMemo(() => {
    if (perfEnabled) {
      // eslint-disable-next-line no-console
      console.time('reports:computeStatements');
    }
    const res = computeStatements(effectiveTxs as any);
    if (perfEnabled) {
      // eslint-disable-next-line no-console
      console.timeEnd('reports:computeStatements');
    }
    return res;
  }, [effectiveTxs, perfEnabled]);
  const pnlRows = useMemo(() => buildPnlRows(effectiveTxs), [effectiveTxs]);
  const balanceBreakdown = useMemo(
    () => buildBalanceBreakdown(effectiveTxs),
    [effectiveTxs]
  );
  const monthlySeries = useMemo(
    () => buildMonthlySeries(effectiveTxs),
    [effectiveTxs]
  );
  const salesByCustomer = useMemo(
    () => buildSalesByCustomerRows(effectiveTxs, customersById),
    [effectiveTxs, customersById]
  );

  const NEEDS_REVIEW_PAGE_SIZE = 20;
  const [needsReviewPage, setNeedsReviewPage] = useState(0);
  const [needsReviewSavingId, setNeedsReviewSavingId] = useState<number | null>(null);

  // Reset paging when the scope changes.
  useEffect(() => {
    setNeedsReviewPage(0);
  }, [activeReportId, selectedBusinessId, startDate, endDate]);

  const needsReviewLoading = false;
  const needsReviewError: string | null = null;

  const needsReviewAll = useMemo(() => {
    if (!selectedBusinessId) return [];
    if (activeReportId !== 'sales_by_customer') return [];
    if (!isIsoDate(startDate) || !isIsoDate(endDate)) return [];
    if (endDate < startDate) return [];

    return effectiveTxs.filter((tx) => {
      const amt = Number(tx.amount) || 0;
      if (amt <= 0) return false;
      const custId = (tx as any).customer_id ?? null;
      return custId === null || custId === '';
    });
  }, [activeReportId, selectedBusinessId, startDate, endDate, effectiveTxs]);

  const needsReviewTotal = needsReviewAll.length;
  const needsReviewRevenueTxs = useMemo(() => {
    const start = needsReviewPage * NEEDS_REVIEW_PAGE_SIZE;
    return needsReviewAll.slice(start, start + NEEDS_REVIEW_PAGE_SIZE);
  }, [needsReviewAll, needsReviewPage]);

  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(needsReviewTotal / NEEDS_REVIEW_PAGE_SIZE) - 1);
    if (needsReviewPage > lastPage) setNeedsReviewPage(lastPage);
  }, [needsReviewTotal, needsReviewPage]);
  const expensesByVendor = useMemo(
    () => buildExpensesByVendorRows(effectiveTxs),
    [effectiveTxs]
  );
  const taxSummary = useMemo(() => buildTaxSummaryRows(effectiveTxs), [effectiveTxs]);

  const activeReport = useMemo(() => {
    return REPORT_LIBRARY.find((r) => r.id === activeReportId) ?? REPORT_LIBRARY[0];
  }, [activeReportId]);

  const filteredLibrary = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = q
      ? REPORT_LIBRARY.filter(
          (r) =>
            r.title.toLowerCase().includes(q) ||
            r.description.toLowerCase().includes(q) ||
            r.category.toLowerCase().includes(q)
        )
      : REPORT_LIBRARY;

    const byCategory = new Map<ReportCategory, typeof items>();
    for (const c of ['Overview', 'Sales', 'Expenses', 'Taxes', 'Cash'] as const) {
      byCategory.set(c, items.filter((r) => r.category === c));
    }
    return byCategory;
  }, [search]);

  const periodLabel = useMemo(() => {
    if (!startDate || !endDate) return '';
    return `${startDate} → ${endDate}`;
  }, [startDate, endDate]);

  useEffect(() => {
    // Optional: hydrate from query params (share link / deep link).
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const report = params.get('report');
    const start = params.get('start');
    const end = params.get('end');
    const b = params.get('basis') as Basis | null;
    if (report && REPORT_LIBRARY.some((r) => r.id === report)) setActiveReportId(report);
    if (start && /^\d{4}-\d{2}-\d{2}$/.test(start)) {
      setStartDate(start);
      setStartText(formatIsoToMdy(start));
    }
    if (end && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
      setEndDate(end);
      setEndText(formatIsoToMdy(end));
    }
    if (b === 'cash' || b === 'accrual') setBasis(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <main>
        {/* Top header */}
        <div className="no-print mb-5 flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-slate-400 text-sm mt-1">
              Pick a report, choose a date range, and review details when needed.
            </p>
          </div>
          <div className="flex items-start gap-3 md:justify-end">
            {toast && (
              <div
                className={classNames(
                  'no-print text-xs rounded-xl border px-3 py-2',
                  toast.tone === 'error'
                    ? 'text-rose-200 border-rose-500/30 bg-rose-500/10'
                    : 'text-emerald-100 border-emerald-500/30 bg-emerald-500/10'
                )}
              >
                {toast.message}
              </div>
            )}
          </div>
        </div>

        {businessError && (
          <div className="no-print mb-4 text-xs text-rose-300">{businessError}</div>
        )}
        {businessLoading && (
          <div className="no-print mb-4 text-xs text-slate-400">Loading business…</div>
        )}

        <div className="grid md:grid-cols-[280px,1fr] gap-4 items-start">
          {/* Left sidebar: report library */}
          <aside className="no-print">
            <GlassCard className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-emerald-400/30 via-sky-400/20 to-blue-500/20 border border-slate-700/60 flex items-center justify-center text-emerald-200">
                  <Icon name="doc" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-100">
                    Report Library
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Search and browse categories
                  </div>
                </div>
              </div>

              <div className="relative mb-3">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                  <Icon name="search" />
                </div>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search reports…"
                  className="w-full rounded-xl bg-slate-950/60 border border-slate-800/80 pl-10 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/60"
                />
              </div>

              <div className="space-y-4">
                {(['Overview', 'Sales', 'Expenses', 'Taxes', 'Cash'] as const).map(
                  (cat) => {
                    const items = filteredLibrary.get(cat) ?? [];
                    if (items.length === 0) return null;
                    return (
                      <div key={cat}>
                        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-2">
                          {cat}
                        </div>
                        <div className="space-y-1">
                          {items.map((r) => {
                            const active = r.id === activeReportId;
                            return (
                              <button
                                key={r.id}
                                type="button"
                                onClick={() => {
                                  setActiveReportId(r.id);
                                }}
                                className={classNames(
                                  'w-full text-left rounded-xl px-3 py-2 border transition relative group',
                                  active
                                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100 shadow-[0_0_0_1px_rgba(16,185,129,0.18)]'
                                    : 'border-transparent bg-slate-900/40 text-slate-200 hover:bg-slate-900/70',
                                )}
                              >
                                <div className="flex items-start gap-2">
                                  <div
                                    className={classNames(
                                      'mt-0.5 h-7 w-7 rounded-lg border flex items-center justify-center',
                                      active
                                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                                        : 'border-slate-700/70 bg-slate-950/30 text-slate-400 group-hover:text-slate-200'
                                    )}
                                  >
                                    <Icon name={r.icon} />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-xs font-semibold truncate">
                                      {r.title}
                                    </div>
                                    <div className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">
                                      {r.description}
                                    </div>
                                  </div>
                                </div>
                                {!active && (
                                  <div className="pointer-events-none absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition shadow-[0_0_24px_rgba(34,197,94,0.08)]" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }
                )}
              </div>
            </GlassCard>
          </aside>

          {/* Main panel */}
          <section className="space-y-4">
            {/* Top filter bar */}
            <GlassCard className="no-print p-4">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">
                      Date range
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative flex items-center gap-1">
                        <input
                          value={startText}
                          onChange={(e) => setStartText(e.target.value)}
                          onBlur={() => {
                            const parsed = parseMdyToIso(startText);
                            if ('iso' in parsed) {
                              setStartDate(parsed.iso);
                              setStartText(formatIsoToMdy(parsed.iso));
                            } else {
                              setToast({ message: parsed.error, tone: 'error' });
                              setStartText(formatIsoToMdy(startDate));
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              (e.currentTarget as HTMLInputElement).blur();
                            }
                          }}
                          inputMode="numeric"
                          placeholder="MM/DD/YYYY"
                          className="w-[118px] bg-transparent border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/60"
                        />
                        <div className="relative">
                          <button
                            type="button"
                            className="h-7 w-9 rounded-lg border border-slate-700 bg-slate-950/40 text-slate-300 hover:bg-slate-900/70"
                            title="Pick a date"
                            onClick={() => {
                              const el = document.getElementById(
                                'reports-start-date-picker'
                              ) as HTMLInputElement | null;
                              el?.showPicker?.();
                              el?.focus();
                            }}
                          >
                            <span className="text-sm">📅</span>
                          </button>
                          <input
                            id="reports-start-date-picker"
                            type="date"
                            value={startDate}
                            onChange={(e) => {
                              const iso = e.target.value;
                              setStartDate(iso);
                              setStartText(formatIsoToMdy(iso));
                            }}
                            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                            tabIndex={-1}
                            aria-hidden="true"
                          />
                        </div>
                      </div>
                      <span className="text-slate-600 text-xs">→</span>
                      <div className="relative flex items-center gap-1">
                        <input
                          value={endText}
                          onChange={(e) => setEndText(e.target.value)}
                          onBlur={() => {
                            const parsed = parseMdyToIso(endText);
                            if ('iso' in parsed) {
                              setEndDate(parsed.iso);
                              setEndText(formatIsoToMdy(parsed.iso));
                            } else {
                              setToast({ message: parsed.error, tone: 'error' });
                              setEndText(formatIsoToMdy(endDate));
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              (e.currentTarget as HTMLInputElement).blur();
                            }
                          }}
                          inputMode="numeric"
                          placeholder="MM/DD/YYYY"
                          className="w-[118px] bg-transparent border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/60"
                        />
                        <div className="relative">
                          <button
                            type="button"
                            className="h-7 w-9 rounded-lg border border-slate-700 bg-slate-950/40 text-slate-300 hover:bg-slate-900/70"
                            title="Pick a date"
                            onClick={() => {
                              const el = document.getElementById(
                                'reports-end-date-picker'
                              ) as HTMLInputElement | null;
                              el?.showPicker?.();
                              el?.focus();
                            }}
                          >
                            <span className="text-sm">📅</span>
                          </button>
                          <input
                            id="reports-end-date-picker"
                            type="date"
                            value={endDate}
                            onChange={(e) => {
                              const iso = e.target.value;
                              setEndDate(iso);
                              setEndText(formatIsoToMdy(iso));
                            }}
                            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                            tabIndex={-1}
                            aria-hidden="true"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {(
                      [
                        { id: 'this_month', label: 'This month' },
                        { id: 'ytd', label: 'YTD' },
                        { id: 'last_year', label: 'Last year' },
                      ] as const
                    ).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          const next = getPresetRange(now, p.id);
                          setStartDate(next.start);
                          setEndDate(next.end);
                          setStartText(formatIsoToMdy(next.start));
                          setEndText(formatIsoToMdy(next.end));
                        }}
                        className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-200 hover:bg-slate-900/70"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">
                      Basis
                    </div>
                    <button
                      type="button"
                      onClick={() => setBasis((b) => (b === 'cash' ? 'accrual' : 'cash'))}
                      className={classNames(
                        'relative h-7 w-14 rounded-full border transition',
                        basis === 'cash'
                          ? 'border-slate-700 bg-slate-900/60'
                          : 'border-emerald-500/40 bg-emerald-500/15'
                      )}
                      aria-label="Toggle cash/accrual basis"
                    >
                      <span
                        className={classNames(
                          'absolute top-0.5 h-6 w-6 rounded-full transition shadow',
                          basis === 'cash'
                            ? 'left-0.5 bg-slate-200/90'
                            : 'left-7 bg-emerald-200'
                        )}
                      />
                    </button>
                    <span className="text-xs text-slate-200 font-semibold">
                      {basis === 'cash' ? 'Cash' : 'Accrual'}
                    </span>
                  </div>
                </div>

              </div>

              <div className="mt-3 text-[11px] text-slate-500">
                Data source: <span className="text-slate-300">transactions</span>{' '}
                filtered by <span className="text-slate-300">business_id</span> and{' '}
                <span className="text-slate-300">date</span> between{' '}
                <span className="text-slate-300">{startDate}</span> and{' '}
                <span className="text-slate-300">{endDate}</span> (inclusive).
              </div>
            </GlassCard>

            {/* Report preview */}
            <div id="report-print" className="report-print">
              <GlassCard className="p-5 print:border-0 print:bg-transparent">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-500/15 via-sky-500/10 to-blue-500/10 border border-slate-800 flex items-center justify-center text-emerald-200">
                      <Icon name={activeReport.icon} className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-slate-100">
                        {activeReport.title}
                      </h2>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {activeReport.description}
                      </p>
                      <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950/40 px-3 py-1 text-[10px] text-slate-300">
                        <span className="text-slate-500">Basis</span>
                        <span className="font-semibold text-slate-100">
                          {basis === 'cash' ? 'Cash' : 'Accrual'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                    Period
                  </div>
                  <div className="text-xs text-slate-200 font-semibold">
                    {periodLabel}
                  </div>
                </div>
              </div>

              {businessLoading ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-5 text-sm text-slate-200">
                  <div className="font-semibold text-slate-100 mb-1">
                    Loading your business…
                  </div>
                  <div className="text-[11px] text-slate-400">
                    We’re linking your account to your business.
                  </div>
                </div>
              ) : !selectedBusinessId ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-5 text-sm text-slate-200">
                  <div className="font-semibold text-slate-100 mb-1">
                    Please log in to view reports
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Your business is automatically linked to your account.
                  </div>
                </div>
              ) : loading ? (
                <div className="text-sm text-slate-200">Loading…</div>
              ) : error ? (
                <div className="text-sm text-rose-300">{error}</div>
              ) : txs.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-5 text-sm text-slate-200">
                  <div className="font-semibold text-slate-100 mb-1">
                    No transactions found in this range
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Try a wider range (YTD / Last year), or import a CSV on the
                    dashboard.
                  </div>
                </div>
              ) : (
                <>
                  {/* KPI row */}
                  <div className="grid md:grid-cols-3 gap-3 mb-4">
                    {activeReport.kind === 'pnl' && (
                      <>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 shadow-[0_0_22px_rgba(34,197,94,0.06)]">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">
                            Total income
                          </div>
                          <div className="mt-1 text-3xl font-semibold text-emerald-300">
                            {formatCurrency(statements.incomeStatement.totalIncome)}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            From {txs.length.toLocaleString('en-US')} transactions
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">
                            Total expenses
                          </div>
                          <div className="mt-1 text-3xl font-semibold text-rose-300">
                            {formatCurrency(-statements.incomeStatement.totalExpenses)}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            Keep an eye on the biggest categories below
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">
                            Net income
                          </div>
                          <div
                            className={classNames(
                              'mt-1 text-3xl font-semibold',
                              statements.incomeStatement.netIncome >= 0
                                ? 'text-emerald-300'
                                : 'text-rose-300'
                            )}
                          >
                            {formatCurrency(statements.incomeStatement.netIncome)}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            Income − expenses
                          </div>
                        </div>
                      </>
                    )}

                    {activeReport.kind === 'balance' && (
                      <>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 shadow-[0_0_22px_rgba(59,130,246,0.06)]">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">
                            Assets
                          </div>
                          <div className="mt-1 text-3xl font-semibold text-blue-200">
                            {formatCurrency(statements.balanceSheet.assets)}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            Best-effort classification by category/type
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">
                            Liabilities
                          </div>
                          <div className="mt-1 text-3xl font-semibold text-rose-300">
                            {formatCurrency(-statements.balanceSheet.liabilities)}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            Includes “loan/credit/tax” category heuristics
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">
                            Equity
                          </div>
                          <div className="mt-1 text-3xl font-semibold text-slate-100">
                            {formatCurrency(statements.balanceSheet.equity)}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            Assets − liabilities (fallback)
                          </div>
                        </div>
                      </>
                    )}

                    {activeReport.kind === 'cashflow' && (
                      <>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">
                            Operating
                          </div>
                          <div className="mt-1 text-3xl font-semibold text-slate-100">
                            {formatCurrency(statements.cashFlow.operating)}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            Derived from income/expense flows
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">
                            Investing
                          </div>
                          <div className="mt-1 text-3xl font-semibold text-slate-100">
                            {formatCurrency(statements.cashFlow.investing)}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            Heuristic category matching
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">
                            Net change
                          </div>
                          <div
                            className={classNames(
                              'mt-1 text-3xl font-semibold',
                              statements.cashFlow.netChange >= 0
                                ? 'text-emerald-300'
                                : 'text-rose-300'
                            )}
                          >
                            {formatCurrency(statements.cashFlow.netChange)}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            Operating + investing + financing
                          </div>
                        </div>
                      </>
                    )}

                    {activeReport.kind === 'sales_by_customer' && (
                      <>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 shadow-[0_0_22px_rgba(34,197,94,0.06)]">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">
                            Customer spend (total)
                          </div>
                          <div className="mt-1 text-3xl font-semibold text-emerald-300">
                            {formatCurrency(salesByCustomer.total)}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {salesByCustomer.rows.length.toLocaleString('en-US')} customers
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">
                            Top customer
                          </div>
                          <div className="mt-1 text-lg font-semibold text-slate-100 whitespace-normal break-words">
                            {salesByCustomer.rows[0]?.name ?? '—'}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {salesByCustomer.rows[0]
                              ? `${salesByCustomer.rows[0].pct.toFixed(1)}% of customer spend`
                              : '—'}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">
                            Grouping
                          </div>
                          <div className="mt-1 text-[11px] text-slate-400">
                            Revenue-only transactions grouped by customer_id.
                          </div>
                        </div>
                      </>
                    )}

                    {activeReport.kind === 'expenses_by_vendor' && (
                      <>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 shadow-[0_0_22px_rgba(251,113,133,0.06)]">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">
                            Total spend
                          </div>
                          <div className="mt-1 text-3xl font-semibold text-rose-300">
                            {formatCurrency(-expensesByVendor.total)}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {expensesByVendor.rows.length.toLocaleString('en-US')} vendors
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">
                            Top vendor
                          </div>
                          <div className="mt-1 text-lg font-semibold text-slate-100 truncate">
                            {expensesByVendor.rows[0]?.name ?? '—'}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {expensesByVendor.rows[0]
                              ? `${expensesByVendor.rows[0].pct.toFixed(1)}% of spend`
                              : '—'}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">
                            Grouping
                          </div>
                          <div className="mt-1 text-[11px] text-slate-400">
                            {expensesByVendor.usedVendorField
                              ? 'Using vendor_name fields when present.'
                              : 'No vendor fields found; using description fallback.'}
                          </div>
                        </div>
                      </>
                    )}

                    {activeReport.kind === 'tax_summary' && (
                      <>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 shadow-[0_0_22px_rgba(96,165,250,0.06)]">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">
                            Estimated taxes owed
                          </div>
                          <div className="mt-1 text-3xl font-semibold text-blue-200">
                            {formatCurrency(taxSummary.estTotalRemaining)}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            Placeholder rates: {(taxSummary.rates.federal * 100).toFixed(0)}% federal +{' '}
                            {(taxSummary.rates.state * 100).toFixed(0)}% state
                          </div>
                          <div className="mt-2 text-[11px] text-slate-400">
                            Taxed: {formatCurrency(taxSummary.taxableIncomeTaxed)} • Not yet taxed:{' '}
                            {formatCurrency(taxSummary.taxableIncomeNotTaxed)}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">
                            Estimated taxable income
                          </div>
                          <div className="mt-1 text-3xl font-semibold text-slate-100">
                            {formatCurrency(taxSummary.estimatedTaxableProfitRemaining)}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            Remaining taxable income {formatCurrency(taxSummary.taxableIncomeNotTaxed)} − remaining deductible expenses{' '}
                            {formatCurrency(-taxSummary.deductibleExpensesNotTaxed)}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">
                            Non-taxable / needs review
                          </div>
                          <div className="mt-1 text-3xl font-semibold text-emerald-300">
                            {formatCurrency(taxSummary.nonTaxableIncome)}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            Non-taxable income (deposits/transfers/owner funds). Review categories below.
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {activeReport.kind === 'tax_summary' && (
                    <div className="mb-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                      <div className="text-[11px] text-slate-300">
                        Based on current data, you may owe{' '}
                        <span className="font-semibold text-slate-100">
                          ~{formatCurrency(taxSummary.estTotalRemaining)}
                        </span>{' '}
                        in taxes if nothing changes.
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        This is an estimate for planning only. It assumes simple taxable income (revenue minus deductible
                        expenses) and placeholder rates.
                      </div>
                    </div>
                  )}

                  <ReportLayout
                    chartTitle="Trend"
                    chartSubtitle={
                      activeReport.kind === 'sales_by_customer' ||
                      activeReport.kind === 'expenses_by_vendor' ||
                      activeReport.kind === 'tax_summary'
                        ? 'Top entities / categories'
                        : 'Monthly aggregation'
                    }
                    chart={
                      activeReport.kind === 'sales_by_customer' ? (
                        <ChartFrame>
                          {salesByCustomer.rows.length === 0 ? (
                            <div className="h-full w-full flex items-center justify-center text-[11px] text-slate-400">
                              No revenue transactions in this range.
                            </div>
                          ) : (
                            <PremiumBarChart
                              data={salesByCustomer.rows.slice(0, 10).map((r) => ({
                                label: r.name,
                                value: r.amount,
                              }))}
                              variant="green"
                              formatValue={(v) => fmtMoneyRounded(v)}
                              formatYAxisTick={(v) => fmtMoneyRounded(v)}
                              tooltipSubtitle="Customer spend"
                              xInterval={0}
                              xAngle={-25}
                              xHeight={58}
                              minHeight={320}
                            />
                          )}
                        </ChartFrame>
                      ) : activeReport.kind === 'expenses_by_vendor' ? (
                        <ChartFrame>
                          {expensesByVendor.rows.length === 0 ? (
                            <div className="h-full w-full flex items-center justify-center text-[11px] text-slate-400">
                              No negative transactions in this range.
                            </div>
                          ) : (
                            <PremiumBarChart
                              data={expensesByVendor.rows.slice(0, 10).map((r) => ({
                                label: r.name.length > 12 ? `${r.name.slice(0, 12)}…` : r.name,
                                value: r.amount,
                              }))}
                              variant="red"
                              formatValue={(v) => fmtMoneyRounded(-v)}
                              formatYAxisTick={(v) => fmtMoneyRounded(-v)}
                              tooltipSubtitle="Spend"
                              minHeight={320}
                            />
                          )}
                        </ChartFrame>
                      ) : activeReport.kind === 'tax_summary' ? (
                        <ChartFrame>
                          {taxSummary.rows.length === 0 ? (
                            <div className="h-full w-full flex items-center justify-center text-[11px] text-slate-400">
                              No transactions to summarize.
                            </div>
                          ) : (
                            <PremiumBarChart
                              data={[
                                { label: 'Gross income', value: taxSummary.totalIncome },
                                { label: 'Est. taxes', value: taxSummary.estTotalRemaining },
                                {
                                  label: 'Net after tax',
                                  value:
                                    (taxSummary.net || 0) - (taxSummary.estTotalRemaining || 0),
                                },
                              ]}
                              variant="blue"
                              formatValue={(v) => fmtMoneyRounded(v)}
                              formatYAxisTick={(v) => fmtMoneyRounded(v)}
                              minHeight={320}
                            />
                          )}
                        </ChartFrame>
                      ) : monthlySeries.length < 2 ? (
                        <div className="h-[320px] w-full flex items-center justify-center text-[11px] text-slate-400">
                          Not enough months in this range to chart yet. Try a wider preset.
                        </div>
                      ) : (
                        <ChartFrame>
                          <ResponsiveContainer width="100%" height="100%" minHeight={320}>
                            <ComposedChart
                              data={monthlySeries}
                              barCategoryGap="22%"
                              onMouseMove={(s: any) => {
                                const idx =
                                  typeof s?.activeTooltipIndex === 'number'
                                    ? s.activeTooltipIndex
                                    : null;
                                setTrendHoverIndex(idx);
                              }}
                              onMouseLeave={() => setTrendHoverIndex(null)}
                            >
                              <defs>
                                <linearGradient id="rg_income" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#34D399" stopOpacity="0.95" />
                                  <stop offset="60%" stopColor="#22C55E" stopOpacity="0.78" />
                                  <stop offset="100%" stopColor="#16A34A" stopOpacity="0.68" />
                                </linearGradient>
                                <linearGradient id="rg_expenses" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#FB7185" stopOpacity="0.95" />
                                  <stop offset="60%" stopColor="#F43F5E" stopOpacity="0.78" />
                                  <stop offset="100%" stopColor="#E11D48" stopOpacity="0.68" />
                                </linearGradient>
                                <filter id="rg_glow_income" x="-40%" y="-40%" width="180%" height="180%">
                                  <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#34D399" floodOpacity="0.18" />
                                  <feDropShadow dx="0" dy="0" stdDeviation="10" floodColor="#38BDF8" floodOpacity="0.12" />
                                </filter>
                                <filter id="rg_glow_expenses" x="-40%" y="-40%" width="180%" height="180%">
                                  <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#FB7185" floodOpacity="0.16" />
                                </filter>
                              </defs>
                              <CartesianGrid
                                stroke="rgba(148,163,184,0.18)"
                                strokeDasharray="2 2"
                                vertical={false}
                              />
                              <XAxis
                                dataKey="label"
                                tick={{ fill: '#94a3b8', fontSize: 11 }}
                                axisLine={{ stroke: '#334155', strokeWidth: 1 }}
                                tickLine={{ stroke: '#334155', strokeWidth: 1 }}
                              />
                              <YAxis
                                tick={{ fill: '#94a3b8', fontSize: 11 }}
                                axisLine={{ stroke: '#334155', strokeWidth: 1 }}
                                tickLine={{ stroke: '#334155', strokeWidth: 1 }}
                                tickFormatter={(v: number) => fmtMoneyRounded(v)}
                              />
                              <Tooltip
                                content={<TrendGlassTooltip />}
                                cursor={{ fill: 'rgba(148,163,184,0.06)' }}
                              />
                              <Bar
                                dataKey="income"
                                fill="url(#rg_income)"
                                radius={[10, 10, 10, 10]}
                                isAnimationActive={true}
                                animationDuration={520}
                                animationEasing="ease-out"
                                barSize={22}
                              >
                                {monthlySeries.map((_, idx) => {
                                  const isActive = trendHoverIndex === idx;
                                  return (
                                    <Cell
                                      key={`inc-${idx}`}
                                      opacity={trendHoverIndex === null || isActive ? 1 : 0.55}
                                      stroke={isActive ? '#34D399' : 'rgba(148,163,184,0.0)'}
                                      strokeWidth={isActive ? 1.5 : 0}
                                      filter={isActive ? 'url(#rg_glow_income)' : undefined}
                                    />
                                  );
                                })}
                                <LabelList
                                  dataKey="income"
                                  content={(props: any) => {
                                    const idx = props?.index as number;
                                    if (trendHoverIndex === null || idx !== trendHoverIndex) return null;
                                    const v = Number(props?.value) || 0;
                                    const x = Number(props?.x) || 0;
                                    const y = Number(props?.y) || 0;
                                    const w = Number(props?.width) || 0;
                                    return (
                                      <text
                                        x={x + w / 2}
                                        y={y - 10}
                                        textAnchor="middle"
                                        fill="#A7F3D0"
                                        fontSize="11"
                                        fontWeight="600"
                                      >
                                        {fmtMoneyRounded(v)}
                                      </text>
                                    );
                                  }}
                                />
                              </Bar>
                              <Bar
                                dataKey="expenses"
                                fill="url(#rg_expenses)"
                                radius={[10, 10, 10, 10]}
                                isAnimationActive={true}
                                animationDuration={520}
                                animationEasing="ease-out"
                                barSize={22}
                              >
                                {monthlySeries.map((_, idx) => {
                                  const isActive = trendHoverIndex === idx;
                                  return (
                                    <Cell
                                      key={`exp-${idx}`}
                                      opacity={trendHoverIndex === null || isActive ? 1 : 0.55}
                                      stroke={isActive ? '#FB7185' : 'rgba(148,163,184,0.0)'}
                                      strokeWidth={isActive ? 1.5 : 0}
                                      filter={isActive ? 'url(#rg_glow_expenses)' : undefined}
                                    />
                                  );
                                })}
                                <LabelList
                                  dataKey="expenses"
                                  content={(props: any) => {
                                    const idx = props?.index as number;
                                    if (trendHoverIndex === null || idx !== trendHoverIndex) return null;
                                    const v = Number(props?.value) || 0;
                                    const x = Number(props?.x) || 0;
                                    const y = Number(props?.y) || 0;
                                    const w = Number(props?.width) || 0;
                                    return (
                                      <text
                                        x={x + w / 2}
                                        y={y - 10}
                                        textAnchor="middle"
                                        fill="#FDA4AF"
                                        fontSize="11"
                                        fontWeight="600"
                                      >
                                        {fmtMoneyRounded(-v)}
                                      </text>
                                    );
                                  }}
                                />
                              </Bar>
                              <Line
                                type="monotone"
                                dataKey="net"
                                stroke="#60a5fa"
                                strokeWidth={2}
                                dot={false}
                                isAnimationActive={false}
                              />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </ChartFrame>
                      )
                    }
                    detailsTitle="Details / Breakdown"
                    detailsRight={
                      <div className="text-[11px] text-slate-500">
                        {txs.length.toLocaleString('en-US')} tx
                      </div>
                    }
                    detailsOpen={detailsOpen}
                    onToggleDetails={() => setDetailsOpen((v) => !v)}
                    printDetails={
                      activeReport.kind === 'tax_summary' ? (
                        <table className="w-full text-xs">
                          <tbody>
                            {[
                              { label: 'Gross income', value: taxSummary.totalIncome },
                              {
                                label: 'Estimated taxes (remaining)',
                                value: taxSummary.estTotalRemaining,
                              },
                              {
                                label: 'Net after tax (est.)',
                                value:
                                  (taxSummary.net || 0) -
                                  (taxSummary.estTotalRemaining || 0),
                              },
                            ].map((r) => (
                              <tr key={r.label}>
                                <td className="py-1 pr-3">{r.label}</td>
                                <td className="py-1 text-right">
                                  {formatCurrency(r.value)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : activeReport.kind === 'sales_by_customer' ? (
                        <table className="w-full text-xs">
                          <thead>
                            <tr>
                              <th className="text-left py-1 pr-3">Customer</th>
                              <th className="text-right py-1">Spend</th>
                            </tr>
                          </thead>
                          <tbody>
                            {salesByCustomer.rows.slice(0, 10).map((r) => (
                              <tr key={r.customer_id ?? r.name}>
                                <td className="py-1 pr-3">{r.name}</td>
                                <td className="py-1 text-right">
                                  {formatCurrency(r.amount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : activeReport.kind === 'expenses_by_vendor' ? (
                        <table className="w-full text-xs">
                          <thead>
                            <tr>
                              <th className="text-left py-1 pr-3">Vendor</th>
                              <th className="text-right py-1">Spend</th>
                            </tr>
                          </thead>
                          <tbody>
                            {expensesByVendor.rows.slice(0, 10).map((r) => (
                              <tr key={r.name}>
                                <td className="py-1 pr-3">{r.name}</td>
                                <td className="py-1 text-right">
                                  {formatCurrency(-r.amount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr>
                              <th className="text-left py-1 pr-3">Month</th>
                              <th className="text-right py-1">Income</th>
                              <th className="text-right py-1">Expenses</th>
                              <th className="text-right py-1">Net</th>
                            </tr>
                          </thead>
                          <tbody>
                            {monthlySeries.map((m) => (
                              <tr key={m.month}>
                                <td className="py-1 pr-3">{m.month}</td>
                                <td className="py-1 text-right">
                                  {formatCurrency(m.income)}
                                </td>
                                <td className="py-1 text-right">
                                  {formatCurrency(-m.expenses)}
                                </td>
                                <td className="py-1 text-right">
                                  {formatCurrency(m.net)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )
                    }
                    details={
                      <div className="overflow-x-auto">
                        {/* Existing breakdown tables moved here; shown only when Details is expanded. */}
                        {activeReport.kind === 'pnl' && (
                          <table className="min-w-full text-xs">
                            <thead className="bg-slate-950/40 text-[11px] text-slate-400">
                              <tr>
                                <th className="text-left px-4 py-2">Category</th>
                                <th className="text-right px-4 py-2">Net</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pnlRows.slice(0, 12).map((r) => (
                                <tr key={r.category} className="border-t border-slate-800/80">
                                  <td
                                    className="px-4 py-2 text-slate-200 whitespace-normal break-words"
                                    title={r.hint}
                                  >
                                    {r.category}
                                  </td>
                                  <td
                                    className={classNames(
                                      'px-4 py-2 text-right font-semibold',
                                      r.net >= 0 ? 'text-emerald-300' : 'text-rose-300'
                                    )}
                                  >
                                    {formatCurrency(r.net)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}

                        {activeReport.kind === 'balance' && (
                          <table className="min-w-full text-xs">
                            <thead className="bg-slate-950/40 text-[11px] text-slate-400">
                              <tr>
                                <th className="text-left px-4 py-2">Section</th>
                                <th className="text-right px-4 py-2">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {balanceBreakdown.assets.slice(0, 6).map((a) => (
                                <tr key={`a-${a.category}`} className="border-t border-slate-800/80">
                                  <td
                                    className="px-4 py-2 text-slate-200 whitespace-normal break-words"
                                    title={cleanLabelAndHint(a.category).hint}
                                  >
                                    Assets · {cleanLabelAndHint(a.category).label}
                                  </td>
                                  <td className="px-4 py-2 text-right text-blue-200 font-semibold">
                                    {formatCurrency(a.amount)}
                                  </td>
                                </tr>
                              ))}

                              {/* Divider after Assets (visual separator between sections) */}
                              {balanceBreakdown.assets.length > 0 &&
                                balanceBreakdown.liabilities.length > 0 && (
                                  <tr className="border-t border-slate-800/80">
                                    <td colSpan={2} className="px-4 py-2">
                                      <div className="h-px w-full bg-slate-800/80" />
                                    </td>
                                  </tr>
                                )}

                              {balanceBreakdown.liabilities.slice(0, 6).map((l, idx) => (
                                <tr
                                  key={`l-${l.category}`}
                                  className={
                                    // Remove the "divider under Liabilities" — the section divider is above.
                                    idx === 0 && balanceBreakdown.assets.length > 0
                                      ? ''
                                      : 'border-t border-slate-800/80'
                                  }
                                >
                                  <td
                                    className="px-4 py-2 text-slate-200 whitespace-normal break-words"
                                    title={cleanLabelAndHint(l.category).hint}
                                  >
                                    Liabilities · {cleanLabelAndHint(l.category).label}
                                  </td>
                                  <td className="px-4 py-2 text-right text-rose-300 font-semibold">
                                    {formatCurrency(-l.amount)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}

                        {activeReport.kind === 'cashflow' && (
                          <table className="min-w-full text-xs">
                            <thead className="bg-slate-950/40 text-[11px] text-slate-400">
                              <tr>
                                <th className="text-left px-4 py-2">Section</th>
                                <th className="text-right px-4 py-2">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[
                                { label: 'Operating', value: statements.cashFlow.operating },
                                { label: 'Investing', value: statements.cashFlow.investing },
                                { label: 'Financing', value: statements.cashFlow.financing },
                                { label: 'Net change', value: statements.cashFlow.netChange },
                              ].map((r) => (
                                <tr key={r.label} className="border-t border-slate-800/80">
                                  <td className="px-4 py-2 text-slate-200">{r.label}</td>
                                  <td
                                    className={classNames(
                                      'px-4 py-2 text-right font-semibold',
                                      r.label === 'Net change'
                                        ? r.value >= 0
                                          ? 'text-emerald-300'
                                          : 'text-rose-300'
                                        : 'text-slate-100'
                                    )}
                                  >
                                    {formatCurrency(r.value)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}

                        {activeReport.kind === 'sales_by_customer' && (
                          <>
                            <table className="min-w-full text-xs">
                              <thead className="bg-slate-950/40 text-[11px] text-slate-400">
                                <tr>
                                  <th className="text-left px-4 py-2">Customer</th>
                                  <th className="text-right px-4 py-2">Customer spend</th>
                                  <th className="text-right px-4 py-2">% of total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {salesByCustomer.rows.slice(0, 10).map((r) => (
                                  <tr
                                    key={r.customer_id ?? r.name}
                                    className="border-t border-slate-800/80"
                                  >
                                    <td
                                      className="px-4 py-2 text-slate-200 whitespace-normal break-words"
                                      title={
                                        r.customer_id
                                          ? `Customer ID: ${r.customer_id}`
                                          : 'Missing customer_id — Needs Review'
                                      }
                                    >
                                      <div className="font-semibold">{r.name}</div>
                                      {!r.customer_id && (
                                        <div className="mt-1 text-[11px] text-slate-500">
                                          These are real sales that haven’t been linked to a customer yet. Assigning them will clean up this report.
                                        </div>
                                      )}
                                    </td>
                                    <td className="px-4 py-2 text-right text-emerald-300 font-semibold">
                                      {formatCurrency(r.amount)}
                                    </td>
                                    <td className="px-4 py-2 text-right text-slate-300">
                                      {r.pct.toFixed(1)}%
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>

                            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/30 p-4">
                              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
                                <div>
                                  <div className="text-xs font-semibold text-slate-200">
                                    Needs Review
                                  </div>
                                  <div className="text-[11px] text-slate-500 mt-0.5">
                                    Revenue transactions missing a customer. Assign one to clean up this report.
                                  </div>
                                </div>
                              </div>

                              {needsReviewLoading ? (
                                <div className="text-[11px] text-slate-500">
                                  Loading unassigned revenue…
                                </div>
                              ) : needsReviewError ? (
                                <div className="text-[11px] text-rose-300">
                                  {needsReviewError}
                                </div>
                              ) : needsReviewRevenueTxs.length === 0 ? (
                                <div className="text-[11px] text-slate-500">
                                  All revenue transactions in this range have a customer assigned.
                                </div>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="min-w-full text-xs">
                                    <thead className="bg-slate-950/40 text-[11px] text-slate-400">
                                      <tr>
                                        <th className="px-3 py-2 text-left">Date</th>
                                        <th className="px-3 py-2 text-left">Description</th>
                                        <th className="px-3 py-2 text-right">Amount</th>
                                        <th className="px-3 py-2 text-left">Assign customer</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {needsReviewRevenueTxs.map((tx) => (
                                        <tr key={tx.id} className="border-t border-slate-800/80">
                                          <td className="px-3 py-2 whitespace-nowrap text-slate-300">
                                            {tx.date}
                                          </td>
                                          <td className="px-3 py-2 text-slate-200 max-w-[420px]">
                                            {tx.description || '—'}
                                          </td>
                                          <td className="px-3 py-2 text-right text-emerald-300 font-semibold whitespace-nowrap">
                                            {formatCurrency(Number(tx.amount) || 0)}
                                          </td>
                                          <td className="px-3 py-2 text-slate-400">
                                            <select
                                              value=""
                                              disabled={
                                                !selectedBusinessId ||
                                                needsReviewSavingId === tx.id
                                              }
                                              onChange={async (e) => {
                                                const custId = e.target.value;
                                                if (!custId || !selectedBusinessId) return;
                                                setNeedsReviewSavingId(tx.id);
                                                try {
                                                  const userIdToUse = userId ?? null;
                                                  if (!userIdToUse) throw new Error('Please log in.');

                                                  const { error } = await supabase
                                                    .from('transactions')
                                                    .update({ customer_id: custId })
                                                    .eq('business_id', selectedBusinessId)
                                                    .eq('id', tx.id);
                                                  if (error) throw error;
                                                  await queryClient.invalidateQueries({
                                                    queryKey: ['transactions', selectedBusinessId],
                                                  });
                                                } catch (err: any) {
                                                  // eslint-disable-next-line no-console
                                                  console.error('ASSIGN_CUSTOMER_ERROR', err);
                                                  setToast({
                                                    message:
                                                      err?.message ??
                                                      'Could not assign customer.',
                                                    tone: 'error',
                                                  });
                                                } finally {
                                                  setNeedsReviewSavingId(null);
                                                }
                                              }}
                                              className="rounded-lg border border-slate-700 bg-slate-950/40 px-2 py-1 text-[11px] text-slate-100"
                                            >
                                              <option value="">Select…</option>
                                              {customersList.map((c) => (
                                                <option key={c.id} value={c.id}>
                                                  {c.name}
                                                  {c.company ? ` (${c.company})` : ''}
                                                </option>
                                              ))}
                                            </select>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>

                                  {needsReviewTotal > NEEDS_REVIEW_PAGE_SIZE && (
                                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-800/70 pt-3">
                                      <div className="text-[11px] text-slate-500">
                                        {(() => {
                                          const start =
                                            needsReviewPage * NEEDS_REVIEW_PAGE_SIZE + 1;
                                          const end = Math.min(
                                            needsReviewTotal,
                                            (needsReviewPage + 1) * NEEDS_REVIEW_PAGE_SIZE
                                          );
                                          const totalPages = Math.max(
                                            1,
                                            Math.ceil(
                                              needsReviewTotal / NEEDS_REVIEW_PAGE_SIZE
                                            )
                                          );
                                          return `Showing ${start}–${end} of ${needsReviewTotal} • Page ${
                                            needsReviewPage + 1
                                          } of ${totalPages}`;
                                        })()}
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          disabled={needsReviewPage === 0 || needsReviewLoading}
                                          onClick={() =>
                                            setNeedsReviewPage((p) => Math.max(0, p - 1))
                                          }
                                          className="rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-1.5 text-[11px] text-slate-100 hover:bg-slate-900/70 disabled:opacity-50"
                                        >
                                          ← Prev
                                        </button>
                                        <button
                                          type="button"
                                          disabled={
                                            needsReviewLoading ||
                                            (needsReviewPage + 1) * NEEDS_REVIEW_PAGE_SIZE >=
                                              needsReviewTotal
                                          }
                                          onClick={() => setNeedsReviewPage((p) => p + 1)}
                                          className="rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-1.5 text-[11px] text-slate-100 hover:bg-slate-900/70 disabled:opacity-50"
                                        >
                                          Next →
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </>
                        )}

                        {activeReport.kind === 'expenses_by_vendor' && (
                          <table className="min-w-full text-xs">
                            <thead className="bg-slate-950/40 text-[11px] text-slate-400">
                              <tr>
                                <th className="text-left px-4 py-2">Vendor</th>
                                <th className="text-right px-4 py-2">Spend</th>
                                <th className="text-right px-4 py-2">% of total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {expensesByVendor.rows.slice(0, 10).map((r) => (
                                <tr key={r.name} className="border-t border-slate-800/80">
                                  <td
                                    className="px-4 py-2 text-slate-200 whitespace-normal break-words"
                                    title={cleanLabelAndHint(r.name).hint}
                                  >
                                    {cleanLabelAndHint(r.name).label}
                                  </td>
                                  <td className="px-4 py-2 text-right text-rose-300 font-semibold">
                                    {formatCurrency(-r.amount)}
                                  </td>
                                  <td className="px-4 py-2 text-right text-slate-300">
                                    {r.pct.toFixed(1)}%
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}

                        {activeReport.kind === 'tax_summary' && (
                          <table className="min-w-full text-xs">
                            <thead className="bg-slate-950/40 text-[11px] text-slate-400">
                              <tr>
                                <th className="text-left px-4 py-2">Category</th>
                                <th className="text-left px-4 py-2">Tax treatment</th>
                                <th className="text-right px-4 py-2">Taxable income</th>
                                <th className="text-right px-4 py-2">Deductible expenses</th>
                                <th className="text-right px-4 py-2">Net taxable</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(taxSummary.taxRows ?? []).slice(0, 12).map((r: any) => (
                                <tr key={r.category} className="border-t border-slate-800/80">
                                  <td
                                    className="px-4 py-2 text-slate-200 whitespace-normal break-words"
                                    title={cleanLabelAndHint(r.category).hint}
                                  >
                                    {r.category}
                                  </td>
                                  <td
                                    className="px-4 py-2 text-slate-300 whitespace-nowrap"
                                    title={
                                      r.tax_category === 'mixed'
                                        ? 'This category contains multiple tax_category values.'
                                        : `tax_category = ${r.tax_category}`
                                    }
                                  >
                                    {r.tax_category}
                                  </td>
                                  <td className="px-4 py-2 text-right text-emerald-300 font-semibold">
                                    {formatCurrency(r.taxableIncome)}
                                  </td>
                                  <td className="px-4 py-2 text-right text-rose-300 font-semibold">
                                    {formatCurrency(-r.deductibleExpenses)}
                                  </td>
                                  <td
                                    className={classNames(
                                      'px-4 py-2 text-right font-semibold',
                                      r.netTaxable >= 0 ? 'text-slate-100' : 'text-rose-200'
                                    )}
                                  >
                                    {formatCurrency(r.netTaxable)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    }
                  />
                </>
              )}
              </GlassCard>
            </div>
          </section>
        </div>
    </main>
  );
}


