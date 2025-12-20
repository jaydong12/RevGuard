/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

// Home dashboard page: the primary RevGuard view with cash insights, CSV import,
// financial statements, daily log, and AI helpers. This file was originally a
// single monolithic page; changes here focus on:
// - Wrapping content in a shared AppLayout with a QuickBooks-style sidebar.
// - Keeping existing behaviour (multi-business, CSV import, AI analyze) intact.
// - Preparing for additional routes like Transactions, Reports, and Pricing.

import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { FormEvent, ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../utils/supabaseClient';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import CashBarChart from '../../components/CashBarChart';
import { IncomeStatementCard } from '../../components/IncomeStatementCard';
import { BalanceSheetCard } from '../../components/BalanceSheetCard';
import { CashFlowCard } from '../../components/CashFlowCard';
import { formatCurrency } from '../../lib/formatCurrency';
import { useQueryClient } from '@tanstack/react-query';
import { useAppData } from '../../components/AppDataProvider';

type Transaction = {
  id: number;
  date: string;
  description: string;
  category: string;
  amount: number;
  customer_name?: string;
  user_id?: string;
  business_id?: string;
};

type AiResult = {
  summary: string;
  recommendations: string[];
};

type InsightPreset = '30d' | '90d' | 'ytd' | 'custom';

type InsightRunResult = {
  what_changed: string[];
  top_drivers: string[];
  next_actions: string[];
  follow_ups: Array<{ label: string; prompt: string }>;
};

type InsightRunRow = {
  id: string;
  created_at: string;
  user_id: string;
  business_id: string;
  preset: InsightPreset;
  from_date: string;
  to_date: string;
  prompt: string | null;
  result: InsightRunResult;
};

type Totals = {
  income: number;
  expenses: number;
  net: number;
};

type BreakdownKind = 'income' | 'expenses';
type StatementKind = 'income' | 'balance' | 'cashflow';
// Legacy range types kept for older helpers; the main chart now uses
// year/month navigation instead of 7D/30D/1Y/All toggles.
type Range = '7d' | '30d' | '90d' | 'ytd' | '1y' | 'all';
type ChartRange = '1m' | '1y' | 'all';
type ReportKind = 'profitability' | 'spending' | 'cashrunway' | 'tax';
type ReportPeriodType = 'month' | 'year';

type PeriodMode = 'month' | 'year';

type SelectedPeriod = {
  mode: PeriodMode; // 'month' or 'year'
  year: number;
  month?: number; // 0–11 when mode === 'month'
};

type MonthSummary = {
  monthKey: string;
  label: string;
  income: number;
  expenses: number;
  net: number;
};

type YearSummary = {
  year: string;
  income: number;
  expenses: number;
  net: number;
};

type DailyLog = {
  id?: number;
  date: string;
  note: string;
};

type TxPoint = {
  x: Date;
  y: number;
  txId: number;
  description: string;
  amount: number;
  category: string;
};

const CATEGORY_OPTIONS = [
  // Income
  'Sales',
  'Services',
  // Operating expenses
  'Payroll',
  'Rent',
  'Utilities',
  'Software',
  'Supplies',
  'Advertising',
  'Insurance',
  'Taxes',
  'Travel',
  'Meals',
  'Fees',
  // Investing / Assets
  'Equipment',
  'Long-term Assets',
  'Equity Investments',
  // Liabilities
  'Loans Payable',
  'Credit Cards',
  'Accounts Payable',
  // Financing / Equity
  'Owner Contributions',
  'Debt Financing',
  // Legacy / fallback
  'Other',
  'Misc',
];

// ---------- helpers ----------

function calculateTotals(transactions: Transaction[]): Totals {
  let income = 0;
  let expenses = 0;
  for (const tx of transactions) {
    if (tx.amount >= 0) income += tx.amount;
    else expenses += Math.abs(tx.amount);
  }
  return { income, expenses, net: income - expenses };
}

function getRangeBounds(range: Range, transactions: Transaction[]): {
  from: Date;
  to: Date;
} {
  const now = new Date();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (range === '7d' || range === '30d' || range === '90d') {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    const from = new Date(to.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    return { from, to };
  }

  if (range === 'ytd') {
    const from = new Date(to.getFullYear(), 0, 1);
    return { from, to };
  }

  if (range === '1y') {
    const from = new Date(to.getFullYear() - 1, to.getMonth(), to.getDate() + 1);
    return { from, to };
  }

  // all-time: use earliest transaction date if we have one
  if (transactions.length > 0) {
    const earliestMs = Math.min(
      ...transactions.map((tx) => new Date(tx.date).getTime())
    );
    const from = new Date(earliestMs);
    return { from, to };
  }

  return { from: to, to };
}

function getFilteredTransactions(
  transactions: Transaction[],
  range: Range
): Transaction[] {
  if (range === 'all') return transactions;
  const { from, to } = getRangeBounds(range, transactions);
  return transactions.filter((tx) => {
    const d = new Date(tx.date);
    return d >= from && d <= to;
  });
}

function generateAlerts(transactions: Transaction[], totals: Totals): string[] {
  const alerts: string[] = [];
  if (!transactions.length) {
    alerts.push(
      'No recent activity yet. Add a few income and expense items so RevGuard can start helping you.'
    );
    return alerts;
  }
  const expenseRatio = totals.income > 0 ? totals.expenses / totals.income : 0;
  if (expenseRatio > 0.7) {
    alerts.push(
      'Your costs are eating most of your income. It may be time to trim a few expenses.'
    );
  }
  const expenseTxs = transactions.filter((tx) => tx.amount < 0);
  if (expenseTxs.length > 0) {
    const biggest = expenseTxs.reduce((a, b) => (a.amount < b.amount ? a : b));
    if (Math.abs(biggest.amount) > totals.income * 0.3) {
      alerts.push(
        `Big spend spotted: "${biggest.description}" for $${Math.abs(
          biggest.amount
        ).toFixed(2)}. Double-check that this was planned and truly necessary.`
      );
    }
  }
  const softwareSpend = transactions
    .filter((tx) => tx.category === 'Software')
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  if (softwareSpend > 0 && softwareSpend > totals.expenses * 0.2) {
    alerts.push(
      "You're spending a lot on software. Make sure you still use and need each subscription."
    );
  }
  return alerts;
}

function getBreakdown(
  transactions: Transaction[],
  kind: BreakdownKind
): { category: string; amount: number }[] {
  const map = new Map<string, number>();
  for (const tx of transactions) {
    if (kind === 'income' && tx.amount <= 0) continue;
    if (kind === 'expenses' && tx.amount >= 0) continue;
    const category = tx.category || 'Uncategorized';
    const amount = Math.abs(tx.amount);
    map.set(category, (map.get(category) ?? 0) + amount);
  }
  return Array.from(map.entries()).map(([category, amount]) => ({
    category,
    amount,
  }));
}

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map((x) => parseInt(x, 10));
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function getMonthlySummaries(transactions: Transaction[]): MonthSummary[] {
  const map = new Map<
    string,
    { income: number; expenses: number; net: number }
  >();
  for (const tx of transactions) {
    const monthKey = tx.date.slice(0, 7);
    if (!map.has(monthKey)) {
      map.set(monthKey, { income: 0, expenses: 0, net: 0 });
    }
    const entry = map.get(monthKey)!;
    if (tx.amount >= 0) entry.income += tx.amount;
    else entry.expenses += Math.abs(tx.amount);
    entry.net = entry.income - entry.expenses;
  }
  const sortedKeys = Array.from(map.keys()).sort();
  return sortedKeys.map((key) => {
    const entry = map.get(key)!;
    return {
      monthKey: key,
      label: formatMonthLabel(key),
      income: entry.income,
      expenses: entry.expenses,
      net: entry.net,
    };
  });
}

function getYearSummaries(transactions: Transaction[]): YearSummary[] {
  const map = new Map<
    string,
    { income: number; expenses: number; net: number }
  >();
  for (const tx of transactions) {
    const year = tx.date.slice(0, 4);
    if (!map.has(year)) {
      map.set(year, { income: 0, expenses: 0, net: 0 });
    }
    const entry = map.get(year)!;
    if (tx.amount >= 0) entry.income += tx.amount;
    else entry.expenses += Math.abs(tx.amount);
    entry.net = entry.income - entry.expenses;
  }
  const sortedYears = Array.from(map.keys()).sort();
  return sortedYears.map((year) => {
    const entry = map.get(year)!;
    return {
      year,
      income: entry.income,
      expenses: entry.expenses,
      net: entry.net,
    };
  });
}

function getYearlyCashSeries(
  transactions: Transaction[]
): { label: string; value: number }[] {
  if (transactions.length === 0) return [];
  const now = new Date();
  const months: { year: number; month: number; key: string; label: string }[] =
    [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    months.push({
      year,
      month,
      key,
      label: d.toLocaleDateString('en-US', { month: 'short' }),
    });
  }
  const netByMonth = new Map<string, number>();
  for (const tx of transactions) {
    const key = tx.date.slice(0, 7);
    netByMonth.set(key, (netByMonth.get(key) ?? 0) + tx.amount);
  }
  let runningCash = 0;
  const series: { label: string; value: number }[] = [];
  for (const m of months) {
    const net = netByMonth.get(m.key) ?? 0;
    runningCash += net;
    series.push({ label: m.label, value: runningCash });
  }
  return series;
}

function getAllTimeCashSeries(
  transactions: Transaction[]
): { label: string; value: number }[] {
  const summaries = getMonthlySummaries(transactions);
  if (summaries.length === 0) return [];
  let runningCash = 0;
  return summaries.map((m) => {
    runningCash += m.net;
    return { label: m.label, value: runningCash };
  });
}

function getMonthCashSeriesByKey(
  transactions: Transaction[],
  monthKey: string
): { label: string; value: number }[] {
  const txs = transactions
    .filter((tx) => tx.date.slice(0, 7) === monthKey)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (txs.length === 0) return [];
  const netByDay = new Map<string, number>();
  for (const tx of txs) {
    const key = tx.date;
    netByDay.set(key, (netByDay.get(key) ?? 0) + tx.amount);
  }
  const sortedDays = Array.from(netByDay.keys()).sort();
  let runningCash = 0;
  return sortedDays.map((day) => {
    runningCash += netByDay.get(day) ?? 0;
    const d = new Date(day);
    const label = d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    return { label, value: runningCash };
  });
}

function buildCashCurveFromTransactions(
  transactions: Transaction[],
  openingBalance: number = 0
): TxPoint[] {
  const sorted = [...transactions].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  let running = openingBalance;
  return sorted.map((tx) => {
    const delta = Number(tx.amount) || 0;
    running += delta;
    return {
      x: new Date(tx.date),
      y: running,
      txId: Number(tx.id),
      description: tx.description,
      amount: delta,
      category: tx.category,
    };
  });
}

function getReportContent(
  kind: ReportKind,
  totals: Totals,
  monthlySummaries: MonthSummary[]
) {
  const lastMonth = monthlySummaries[monthlySummaries.length - 1];
  switch (kind) {
    case 'profitability': {
      const margin =
        totals.income > 0 ? (totals.net / totals.income) * 100 : 0;
      const marginText =
        totals.income === 0
          ? 'There is no income in this view yet, so we cannot judge profit.'
          : totals.net >= 0
          ? `You're keeping about ${margin.toFixed(
              1
            )}% of what you bring in as profit.`
          : `You are losing about ${Math.abs(margin).toFixed(
              1
            )}% of your income in this view.`;
      return {
        title: 'Profit Report',
        intro:
          'This view tells you in plain language if your business is actually making money after expenses.',
        bullets: [
          `Income in this range: $${totals.income.toFixed(2)}`,
          `Expenses in this range: $${totals.expenses.toFixed(2)}`,
          `Net profit: ${
            totals.net >= 0 ? '+' : '-'
          }$${Math.abs(totals.net).toFixed(2)}`,
          marginText,
        ],
        tip:
          totals.net >= 0
            ? 'If profit looks healthy, think about where to reinvest it: better marketing, better tools, or paying yourself more.'
            : 'If profit is negative, pick one or two expense categories to cut first instead of trying to fix everything at once.',
      };
    }
    case 'spending': {
      const biggestSpendMonth =
        monthlySummaries.length > 0
          ? monthlySummaries.reduce((a, b) =>
              a.expenses >= b.expenses ? a : b
            )
          : null;
      return {
        title: 'Spending Habits',
        intro:
          'This report shows how your money is leaving the business so you can spot waste and set limits.',
        bullets: [
          `Total spent in this view: $${totals.expenses.toFixed(2)}`,
          lastMonth
            ? `Most recent month: you spent $${lastMonth.expenses.toFixed(
                2
              )} and made $${lastMonth.income.toFixed(2)}.`
            : 'No monthly data yet to break down.',
          biggestSpendMonth
            ? `Your highest-spend month here was ${
                biggestSpendMonth.label
              } with $${biggestSpendMonth.expenses.toFixed(2)} going out.`
            : 'Once you have more months of data, RevGuard will highlight your heaviest spending month.',
        ],
        tip:
          "Pick 1–3 categories (like software, ads, or payroll) and give each a simple monthly budget. RevGuard can help you see when you're breaking your own rules.",
      };
    }
    case 'cashrunway': {
      const avgMonthlyNet =
        monthlySummaries.length > 0
          ? monthlySummaries.reduce((s, m) => s + m.net, 0) /
            monthlySummaries.length
          : 0;
      return {
        title: 'Cash Runway',
        intro:
          'This report gives you a simple sense of "How long can I keep running like this before money gets tight?"',
        bullets: [
          `Average monthly profit in this view: ${
            avgMonthlyNet >= 0 ? '+' : '-'
          }$${Math.abs(avgMonthlyNet).toFixed(2)}`,
          totals.net >= 0
            ? 'You are currently cash-positive in this range, which means your runway is getting longer each month.'
            : 'You are currently burning cash in this range, which slowly shortens your runway.',
          'For a stronger buffer, many owners try to keep 3–6 months of expenses in cash if possible.',
        ],
        tip: "Look at your cash curve chart. If it slopes up, you're building safety. If it slopes down, decide whether to adjust your spending or increase revenue.",
      };
    }
    case 'tax': {
      return {
        title: 'Tax-Ready Check',
        intro:
          'This report is not tax advice, but it tells you how "clean" your numbers are for tax time.',
        bullets: [
          'You have your income and expenses separated, which is the first step to being tax-ready.',
          'Each transaction should have a clear category (like "Meals", "Equipment", "Rent", "Payroll") so write-offs are easier to track.',
          'Keeping everything in one tool all year is much cheaper than trying to fix a box of receipts at the end.',
        ],
        tip: "Once this is live with real data, you'll be able to export clean reports for your tax preparer instead of handing them a mess.",
      };
    }
  }
}

function filterTransactionsByPeriod(
  txs: Transaction[],
  period: SelectedPeriod | null
): Transaction[] {
  if (!period) return txs;
  return txs.filter((tx) => {
    const d = new Date(tx.date);
    if (Number.isNaN(d.getTime())) return false;
    const y = d.getFullYear();
    const m = d.getMonth();
    if (period.mode === 'year') {
      return y === period.year;
    }
    // month mode
    return y === period.year && m === period.month;
  });
}

function getEndOfPeriod(period: SelectedPeriod | null): Date {
  if (!period) return new Date(8640000000000000); // far future; acts like "all time"
  if (period.mode === 'year') {
    return new Date(period.year, 11, 31, 23, 59, 59, 999);
  }
  const month = period.month ?? 11;
  return new Date(period.year, month + 1, 0, 23, 59, 59, 999);
}

function getPreviousPeriod(period: SelectedPeriod | null): SelectedPeriod | null {
  if (!period) return null;
  if (period.mode === 'year') {
    return { mode: 'year', year: period.year - 1 };
  }
  const y = period.year;
  const m = period.month ?? 0;
  if (m > 0) {
    return { mode: 'month', year: y, month: m - 1 };
  }
  return { mode: 'month', year: y - 1, month: 11 };
}

type AiSection = {
  title: string;
  items: string[];
};

function parseAiSections(text: string): AiSection[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const sections: AiSection[] = [];
  let current: AiSection | null = null;

  const isHeading = (line: string): boolean => {
    const upper = line.toUpperCase();
    return (
      upper.startsWith('SNAPSHOT') ||
      upper.startsWith('PROBLEMS TO WATCH') ||
      upper.startsWith('ACTION PLAN')
    );
  };

  const normalizeTitle = (line: string): string =>
    line.replace(/[:\-]+$/, '').toUpperCase();

  for (const rawLine of lines) {
    if (isHeading(rawLine)) {
      if (current && current.items.length > 0) {
        sections.push(current);
      }
      current = { title: normalizeTitle(rawLine), items: [] };
      continue;
    }

    const bullet = rawLine.replace(/^[\-\u2022•\d\.\)\s]+/, '').trim();
    if (!bullet) continue;

    if (!current) {
      current = { title: 'SNAPSHOT', items: [] };
    }
    current.items.push(bullet);
  }

  if (current && current.items.length > 0) {
    sections.push(current);
  }

  if (!sections.length && text.trim()) {
    sections.push({
      title: 'SNAPSHOT',
      items: [text.trim()],
    });
  }

  return sections;
}

/** Normalize an amount from CSV: strip $, commas, spaces, etc. */
function normalizeAmount(raw: any): number | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).replace(/[^0-9.-]/g, '');
  if (!cleaned) return null;
  const val = Number.parseFloat(cleaned);
  return Number.isNaN(val) ? null : val;
}

/** Normalize dates into YYYY-MM-DD; return null if totally broken */
function normalizeDate(raw: any): string | null {
  if (!raw) return null;
  const str = String(raw).trim();
  if (!str) return null;

  // Already ISO-like: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // MM/DD/YYYY or MM-DD-YYYY (or 2-digit year)
  const m = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const [, mm, dd, yy] = m;
    let yyyy = yy;
    if (yyyy.length === 2) {
      const yrNum = Number(yyyy);
      yyyy = yrNum >= 70 ? `19${yyyy}` : `20${yyyy}`;
    }
    const month = String(Number(mm)).padStart(2, '0');
    const day = String(Number(dd)).padStart(2, '0');
    return `${yyyy}-${month}-${day}`;
  }

  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

/** Normalize categories to your known options, defaulting to "Uncategorized". */
function normalizeCategory(raw: any): string {
  const fallback = 'Uncategorized';
  if (!raw) return fallback;
  const str = String(raw).trim();
  if (!str) return fallback;
  const lower = str.toLowerCase();
  const found = CATEGORY_OPTIONS.find((opt) => opt.toLowerCase() === lower);
  return found || fallback;
}

// ---------- import mapping config ----------

const TARGET_COLUMNS = [
  'date',
  'description',
  'category',
  'amount',
] as const;
type TargetCol = (typeof TARGET_COLUMNS)[number];

// Only "amount" MUST be mapped.
// Date will default to today if missing/bad.
// Description/category get safe defaults.
const REQUIRED_COLUMNS: TargetCol[] = ['amount'];

function isMappingValid(map: Record<string, string>): boolean {
  return REQUIRED_COLUMNS.every((col) => !!map[col]);
}

function autoMapColumns(cols: string[]) {
  const map: Record<string, string> = {};
  const lowerCols = cols.map((c) => String(c));
  const findFirst = (pred: (c: string) => boolean) =>
    lowerCols.find((c) => pred(c.toLowerCase())) ?? '';

  for (const target of TARGET_COLUMNS) {
    if (target === 'amount') {
      // Common CSV headers: amount, value, total, debit/credit, in/out
      map[target] = findFirst((c) =>
        ['amount', 'value', 'total', 'amt', 'debit', 'credit', 'in', 'out'].some(
          (k) => c === k || c.includes(k)
        )
      );
      continue;
    }
    if (target === 'date') {
      map[target] = findFirst((c) =>
        ['date', 'posted', 'transaction date', 'txn date'].some(
          (k) => c === k || c.includes(k)
        )
      );
      continue;
    }
    if (target === 'description') {
      map[target] = findFirst((c) =>
        ['description', 'memo', 'note', 'details', 'narration'].some(
          (k) => c === k || c.includes(k)
        )
      );
      continue;
    }
    if (target === 'category') {
      map[target] = findFirst((c) =>
        ['category', 'type', 'account', 'class'].some(
          (k) => c === k || c.includes(k)
        )
      );
      continue;
    }
  }

  // Optional: detect customer column for linking customers during import
  map['customer'] = findFirst((c) =>
    ['customer', 'client', 'payer', 'payor', 'customer name', 'customer_name'].some(
      (k) => c === k || c.includes(k)
    )
  );

  return map;
}

function getRangeLabel(range: Range): string {
  switch (range) {
    case '7d':
      return 'Last 7 days';
    case '30d':
      return 'Last 30 days';
    case '90d':
      return 'Last 90 days';
    case 'ytd':
      return 'Year to date';
    case '1y':
      return 'Last 12 months';
    case 'all':
    default:
      return 'All time';
  }
}

export default function DashboardHome() {
  const perfEnabled = useMemo(() => {
    try {
      return typeof window !== 'undefined' && localStorage.getItem('revguard:perf') === '1';
    } catch {
      return false;
    }
  }, []);
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    businessId: selectedBusinessId,
    userId,
    transactions: transactionsRaw,
    loading: businessLoading,
    error: businessError,
  } = useAppData();

  const transactions = (transactionsRaw as any[]) as Transaction[];
  const [range, setRange] = useState<Range>('30d');
  const [selectedBreakdown, setSelectedBreakdown] =
    useState<BreakdownKind | null>(null);
  const [selectedStatement, setSelectedStatement] =
    useState<StatementKind>('income');
  const [selectedReport, setSelectedReport] =
    useState<ReportKind>('profitability');
  const [reportPeriodType, setReportPeriodType] =
    useState<ReportPeriodType>('month');

  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);
  const [selectedReportMonthKey, setSelectedReportMonthKey] =
    useState<string | null>(null);
  const [selectedReportYear, setSelectedReportYear] =
    useState<string | null>(null);

  // Scenario
  const [showScenario, setShowScenario] = useState(false);
  const [scenario, setScenario] = useState<Record<string, number>>({});
  const [scenarioActive, setScenarioActive] = useState(false);
  const allCategories = [
    'Payroll',
    'Services',
    'Advertising',
    'Software',
    'Supplies',
    'Misc',
  ];

  const isTxLoading = businessLoading;
  const txError = businessError;

  // AI Insights (reusable runs + history)
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [insightPreset, setInsightPreset] = useState<InsightPreset>('30d');
  const [insightCustomFrom, setInsightCustomFrom] = useState<string>('');
  const [insightCustomTo, setInsightCustomTo] = useState<string>('');
  const [insightRuns, setInsightRuns] = useState<InsightRunRow[]>([]);
  const [activeInsightRunId, setActiveInsightRunId] = useState<string | null>(
    null
  );
  const [aiInsightRunsEnabled, setAiInsightRunsEnabled] = useState<boolean>(() => {
    try {
      // If we previously detected the table is missing, do not keep retrying.
      return sessionStorage.getItem('revguard:ai_insight_runs_missing') !== '1';
    } catch {
      return true;
    }
  });

  function isMissingAiInsightRunsTable(err: any): boolean {
    const msg = String(err?.message ?? err ?? '').toLowerCase();
    // Typical PostgREST missing-table errors:
    // - "Could not find the table 'public.ai_insight_runs' in the schema cache"
    // - 404s that mention schema cache / relation does not exist
    return (
      msg.includes('ai_insight_runs') &&
      (msg.includes('schema cache') ||
        msg.includes('could not find the table') ||
        msg.includes('does not exist') ||
        msg.includes('relation'))
    );
  }

  function disableAiInsightRunsQueries() {
    setAiInsightRunsEnabled(false);
    try {
      sessionStorage.setItem('revguard:ai_insight_runs_missing', '1');
    } catch {
      // ignore
    }
  }

  function rangeKeyForRun(r: Pick<InsightRunRow, 'from_date' | 'to_date'>) {
    return `${r.from_date}__${r.to_date}`;
  }

  function normalizeInsightRuns(runs: InsightRunRow[]): InsightRunRow[] {
    // Sort newest first, then dedupe by date range, then keep only the most recent 5.
    const sorted = [...runs].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const seen = new Set<string>();
    const unique: InsightRunRow[] = [];
    for (const r of sorted) {
      const key = rangeKeyForRun(r);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(r);
      if (unique.length >= 5) break;
    }
    return unique;
  }

  // Daily log (disabled for now – reserved for future use)

  // Import
  const [showImport, setShowImport] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importStage, setImportStage] = useState<
    'idle' | 'parsing' | 'ready' | 'importing' | 'done' | 'error'
  >('idle');
  const [importColumns, setImportColumns] = useState<string[]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [importRows, setImportRows] = useState<any[]>([]);
  const [importLog, setImportLog] = useState<string>('');
  const [mapError, setMapError] = useState<string | null>(null);
  const [importToast, setImportToast] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!importToast) return;
    const t = window.setTimeout(() => setImportToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [importToast]);

  // PDF
  const pdfRef = useRef<HTMLDivElement | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  // Year + month navigation for the cash curve
  const [selectedYear, setSelectedYear] = useState<number | 'all'>();
  const [selectedMonth, setSelectedMonth] = useState<'all' | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11>(
    'all'
  );

  // Unified period selection shared by the cash chart, KPI cards, and
  // financial statements. When null, views fall back to all-time.
  const [selectedPeriod, setSelectedPeriod] =
    useState<SelectedPeriod | null>(null);

  // Keep the CashBarChart year navigation in sync with the dashboard's
  // year/month filters that determine which transactions are fed into the chart.
  // Without this, Prev/Next year can update `selectedPeriod` but the input data
  // remains filtered to the old `selectedYear`, making the buttons appear broken.
  function handleCashChartPeriodChange(p: SelectedPeriod) {
    setSelectedPeriod(p);
    setSelectedYear(p.year);
    if (p.mode === 'month') {
      if (typeof p.month === 'number') setSelectedMonth(p.month);
      else setSelectedMonth('all');
    } else {
      // In "year" mode, the chart wants the whole year. Clear month filter.
      setSelectedMonth('all');
    }
  }

  // Financial statements load via a year-scoped date-range query on `date`
  // so prior years render reliably (no reliance on `created_at`).
  const isStatementsLoading = false;
  const statementsError: string | null = null;

  // ---------- scenario helper ----------

  const plotted = useMemo((): Transaction[] => {
    if (!scenarioActive) return transactions;
    const adjustment: Record<string, number> = scenario;
    return transactions.map((tx) => {
      const adj = adjustment[tx.category] || 0;
      return {
        ...tx,
        amount: Math.round(tx.amount * (1 + adj / 100) * 100) / 100,
      };
    });
  }, [scenarioActive, scenario, transactions]);

  // Transactions are loaded once in `AppDataProvider` (React Query) and cached by `business_id`.

  // ---------- core derived data ----------

  const filteredTransactions = useMemo(
    () => getFilteredTransactions(transactions, range),
    [transactions, range]
  );
  const totals = useMemo(
    () => calculateTotals(filteredTransactions),
    [filteredTransactions]
  );
  const alerts = useMemo(
    () => generateAlerts(filteredTransactions, totals),
    [filteredTransactions, totals]
  );
  const breakdown = useMemo(
    () =>
      selectedBreakdown
        ? getBreakdown(filteredTransactions, selectedBreakdown)
        : [],
    [filteredTransactions, selectedBreakdown]
  );

  const monthlySummaries = useMemo(
    () => getMonthlySummaries(filteredTransactions),
    [filteredTransactions]
  );
  const allMonthSummaries = useMemo(
    () => getMonthlySummaries(transactions),
    [transactions]
  );
  const yearSummaries = useMemo(() => getYearSummaries(transactions), [transactions]);

  // Distinct years present in the transaction data, oldest -> newest.
  const years = useMemo(() => {
    const set = new Set<number>();
    for (const tx of transactions) {
      if (!tx.date) continue;
      const d = new Date(tx.date);
      if (Number.isNaN(d.getTime())) continue;
      set.add(d.getFullYear());
    }
    return Array.from(set.values()).sort((a, b) => a - b);
  }, [transactions]);

  // Default the selected year to the latest year once data is available.
  useEffect(() => {
    if (years.length > 0 && selectedYear === undefined) {
      setSelectedYear(years[years.length - 1]);
    }
  }, [years, selectedYear]);

  // Apply year + month navigation just for the cash curve.
  const yearFilteredTxs = useMemo(() => {
    if (selectedYear === 'all' || selectedYear === undefined) return plotted;
    return plotted.filter((tx) => {
      const d = new Date(tx.date);
      if (Number.isNaN(d.getTime())) return false;
      return d.getFullYear() === selectedYear;
    });
  }, [plotted, selectedYear]);

  const monthFilteredTxs = useMemo(() => {
    if (selectedMonth === 'all') return yearFilteredTxs;
    return yearFilteredTxs.filter((tx) => {
      const d = new Date(tx.date);
      if (Number.isNaN(d.getTime())) return false;
      return d.getMonth() === selectedMonth;
    });
  }, [yearFilteredTxs, selectedMonth]);

  const chartTxs = useMemo((): Transaction[] => {
    if (range === '1y') {
      // 1Y now means "selected year" (plus optional month filter) for the chart.
      return monthFilteredTxs;
    }
    // Other ranges still apply (7D, 30D, All), intersected with the year/month filter.
    return getFilteredTransactions(monthFilteredTxs, range);
  }, [monthFilteredTxs, range]);

  const chartBounds = useMemo(() => {
    const ds = chartTxs
      .map((t) => new Date(t.date))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
    return {
      start: ds[0]?.toISOString().slice(0, 10) ?? 'none',
      end: ds[ds.length - 1]?.toISOString().slice(0, 10) ?? 'none',
    };
  }, [chartTxs]);

  // Debug: verify we are actually feeding the chart non-empty, correctly filtered data.
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[DashboardHome:CashOverview]', {
      transactionsTotal: transactions?.length ?? 0,
      plottedCount: plotted.length,
      chartTxsCount: chartTxs.length,
      businessId: selectedBusinessId ?? null,
      range,
      selectedYear,
      selectedMonth,
      chartStart: chartBounds.start,
      chartEnd: chartBounds.end,
      sampleDates: chartTxs.slice(0, 5).map((t) => t.date),
    });
  }, [
    transactions?.length,
    plotted.length,
    chartTxs.length,
    selectedBusinessId,
    range,
    selectedYear,
    selectedMonth,
    chartBounds.start,
    chartBounds.end,
  ]);

  const chartPoints = useMemo(() => {
    if (perfEnabled) {
      // eslint-disable-next-line no-console
      console.time('dashboard:buildCashCurve');
    }
    const res = buildCashCurveFromTransactions(chartTxs, 0);
    if (perfEnabled) {
      // eslint-disable-next-line no-console
      console.timeEnd('dashboard:buildCashCurve');
    }
    return res;
  }, [chartTxs, perfEnabled]);
  const chartSeries = useMemo(
    () =>
      chartPoints.map((p) => ({
        label: p.x.toISOString().split('T')[0],
        value: p.y,
      })),
    [chartPoints]
  );

  function projectLine(
    series: { label: string; value: number }[],
    days: number
  ): { label: string; value: number }[] {
    if (!series.length) return [];
    const lastVal = series[series.length - 1].value;
    const netPerStep =
      series.length > 1
        ? (series[series.length - 1].value - series[0].value) /
          (series.length - 1)
        : 0;
    return Array.from({ length: days }, (_, i) => ({
      label: `+${i + 1}`,
      value: lastVal + netPerStep * (i + 1),
    }));
  }

  // quick forecast
  const { avgDailyNet, projected30, currentCash, runwayDays } = useMemo(() => {
    if (filteredTransactions.length === 0) {
      return { avgDailyNet: 0, projected30: 0, currentCash: 0, runwayDays: null as number | null };
    }

    const timestamps = filteredTransactions.map((tx) => new Date(tx.date).getTime());
    const earliest = Math.min(...timestamps);
    const latest = Math.max(...timestamps);
    const diffMs = latest - earliest;
    const diffDays = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1);
    const totalNet = filteredTransactions.reduce((sum, tx) => sum + tx.amount, 0);
    const avg = totalNet / diffDays;
    const cash = totalNet;
    const proj30 = cash + avg * 30;
    const runway = avg < 0 && cash > 0 ? Math.floor(cash / Math.abs(avg)) : null;
    return { avgDailyNet: avg, projected30: proj30, currentCash: cash, runwayDays: runway };
  }, [filteredTransactions]);

  const chartTitle = useMemo(() => {
    return selectedYear && selectedYear !== 'all'
      ? `Cash Curve – ${selectedYear}`
      : `Cash Curve – ${getRangeLabel(range)}`;
  }, [selectedYear, range]);

  const reportContent = useMemo(
    () => getReportContent(selectedReport, totals, monthlySummaries),
    [selectedReport, totals, monthlySummaries]
  );

  const activeReportMonthKey = useMemo(() => {
    return (
      selectedReportMonthKey ??
      (allMonthSummaries.length
        ? allMonthSummaries[allMonthSummaries.length - 1].monthKey
        : null)
    );
  }, [selectedReportMonthKey, allMonthSummaries]);

  const activeReportMonth = useMemo(() => {
    return activeReportMonthKey
      ? allMonthSummaries.find((m) => m.monthKey === activeReportMonthKey) ?? null
      : null;
  }, [activeReportMonthKey, allMonthSummaries]);

  const activeReportMonthCumulativeCash = useMemo(() => {
    if (!activeReportMonth) return 0;
    const idx = allMonthSummaries.findIndex(
      (m) => m.monthKey === activeReportMonth.monthKey
    );
    let sum = 0;
    for (let i = 0; i <= idx; i++) sum += allMonthSummaries[i].net;
    return sum;
  }, [activeReportMonth, allMonthSummaries]);

  const activeReportYear = useMemo(() => {
    return (
      selectedReportYear ??
      (yearSummaries.length ? yearSummaries[yearSummaries.length - 1].year : null)
    );
  }, [selectedReportYear, yearSummaries]);

  const activeReportYearSummary = useMemo(() => {
    return activeReportYear
      ? yearSummaries.find((y) => y.year === activeReportYear) ?? null
      : null;
  }, [activeReportYear, yearSummaries]);

  // Period-specific view driven by the shared selectedPeriod state. This powers
  // the KPI cards and ensures they stay in sync with the cash chart and
  // financial statements.
  const periodTransactions = useMemo(
    () => filterTransactionsByPeriod(transactions, selectedPeriod),
    [transactions, selectedPeriod]
  );

  const { incomeThisPeriod, expensesThisPeriod, netChangeThisPeriod } = useMemo(() => {
    let income = 0;
    let expenses = 0;
    let net = 0;
    for (const tx of periodTransactions) {
      const amt = Number(tx.amount) || 0;
      if (amt >= 0) income += amt;
      else expenses += Math.abs(amt);
      net += amt;
    }
    return { incomeThisPeriod: income, expensesThisPeriod: expenses, netChangeThisPeriod: net };
  }, [periodTransactions]);

  const endOfPeriod = useMemo(
    () => getEndOfPeriod(selectedPeriod),
    [selectedPeriod]
  );

  const cashBalanceAtEndOfPeriod = useMemo(
    () =>
      transactions
        .filter((tx) => {
          const d = new Date(tx.date);
          if (Number.isNaN(d.getTime())) return false;
          return d <= endOfPeriod;
        })
        .reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0),
    [transactions, endOfPeriod]
  );

  const prevPeriod = useMemo(
    () => getPreviousPeriod(selectedPeriod),
    [selectedPeriod]
  );

  const prevPeriodTransactions = useMemo(
    () => filterTransactionsByPeriod(transactions, prevPeriod),
    [transactions, prevPeriod]
  );

  const { revenuePrev, expensesPrev, netProfitPrev } = useMemo(() => {
    let revenue = 0;
    let expenses = 0;
    let net = 0;
    for (const tx of prevPeriodTransactions) {
      const amt = Number(tx.amount) || 0;
      if (amt >= 0) revenue += amt;
      else expenses += Math.abs(amt);
      net += amt;
    }
    return { revenuePrev: revenue, expensesPrev: expenses, netProfitPrev: net };
  }, [prevPeriodTransactions]);

  // ------- Financial statement data (simple, from transactions) -------

  const incomeBreakdown = useMemo(
    () => getBreakdown(filteredTransactions, 'income'),
    [filteredTransactions]
  );
  const expenseBreakdown = useMemo(
    () => getBreakdown(filteredTransactions, 'expenses'),
    [filteredTransactions]
  );

  const periodIncomeBreakdown = useMemo(
    () => getBreakdown(periodTransactions, 'income'),
    [periodTransactions]
  );
  const periodExpenseBreakdown = useMemo(
    () => getBreakdown(periodTransactions, 'expenses'),
    [periodTransactions]
  );

  const allTotals = useMemo(() => calculateTotals(transactions), [transactions]);
  const currentCashBalance = allTotals.net;

  // Year used by the Financial Statements panel. It follows the shared
  // selectedPeriod if available, otherwise falls back to the latest tx year.
  const selectedYearForStatements = useMemo(() => {
    if (selectedPeriod?.year) return selectedPeriod.year;
    if (!transactions || transactions.length === 0) return null;
    const dates = transactions
      .map((tx) => new Date(tx.date))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => b.getTime() - a.getTime());
    return dates[0]?.getFullYear() ?? null;
  }, [selectedPeriod, transactions]);

  const statementTransactions = useMemo(() => {
    if (!selectedYearForStatements) return [];
    return transactions.filter((tx) => {
      if (!tx.date) return false;
      const d = new Date(tx.date);
      if (Number.isNaN(d.getTime())) return false;
      return d.getFullYear() === selectedYearForStatements;
    });
  }, [transactions, selectedYearForStatements]);

  // Breakdowns and totals for the statement view
  const statementTotals = useMemo(
    () => calculateTotals(statementTransactions),
    [statementTransactions]
  );
  const statementIncomeBreakdown = useMemo(
    () => getBreakdown(statementTransactions, 'income'),
    [statementTransactions]
  );
  const statementExpenseBreakdown = useMemo(
    () => getBreakdown(statementTransactions, 'expenses'),
    [statementTransactions]
  );

  // Derive simple "liabilities" from negative cash (overdrawn) plus any
  // transactions tagged with liability-style categories. This keeps the view
  // simple while still surfacing when cash is effectively negative.
  function isLiabilityCategory(cat: string | null | undefined): boolean {
    if (!cat) return false;
    const c = cat.toLowerCase();
    return (
      c.includes('loan') ||
      c.includes('credit') ||
      c.includes('tax') ||
      c.includes('payable') ||
      c.includes('liabil')
    );
  }

  const { liabilityFromCategories } = useMemo(() => {
    const liabilityByCategory = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.amount < 0 && isLiabilityCategory(tx.category)) {
        const key = tx.category || 'Liabilities';
        liabilityByCategory.set(
          key,
          (liabilityByCategory.get(key) ?? 0) + Math.abs(tx.amount)
        );
      }
    }
    const liabilityFromCategories = Array.from(liabilityByCategory.values()).reduce(
      (sum, v) => sum + v,
      0
    );
    return { liabilityFromCategories };
  }, [transactions]);

  const liabilityFromNegativeCash = currentCashBalance < 0 ? -currentCashBalance : 0;

  const balanceTotalLiabilities = liabilityFromCategories + liabilityFromNegativeCash;
  const balanceTotalAssets = Math.max(currentCashBalance, 0);
  const balanceTotalEquity = balanceTotalAssets - balanceTotalLiabilities;

  const { cfIn, cfOut, cfNet } = useMemo(() => {
    let cfIn = 0;
    let cfOut = 0;
    for (const tx of filteredTransactions) {
      if (tx.amount > 0) cfIn += tx.amount;
      else cfOut += Math.abs(tx.amount);
    }
    return { cfIn, cfOut, cfNet: cfIn - cfOut };
  }, [filteredTransactions]);

  // Additional statement metrics for more detail
  const {
    incomeCount,
    expenseCount,
    avgIncomeAmount,
    avgExpenseAmount,
    profitMarginPct,
    topIncomeCategories,
    topExpenseCategories,
    biggestIncomeSources,
    biggestExpenseCategories,
  } = useMemo(() => {
    const incomeTxs = filteredTransactions.filter((tx) => tx.amount >= 0);
    const expenseTxs = filteredTransactions.filter((tx) => tx.amount < 0);
    const incomeCount = incomeTxs.length;
    const expenseCount = expenseTxs.length;
    const avgIncomeAmount =
      incomeCount > 0
        ? incomeTxs.reduce((s, tx) => s + tx.amount, 0) / incomeCount
        : 0;
    const avgExpenseAmount =
      expenseCount > 0
        ? expenseTxs.reduce((s, tx) => s + Math.abs(tx.amount), 0) / expenseCount
        : 0;
    const profitMarginPct = totals.income > 0 ? (totals.net / totals.income) * 100 : 0;

    const topIncomeCategories = [...incomeBreakdown]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3);
    const topExpenseCategories = [...expenseBreakdown]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3);

    const biggestIncomeSources = [...periodIncomeBreakdown]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3)
      .map((row) => ({ name: row.category, amount: row.amount }));

    const biggestExpenseCategories = [...periodExpenseBreakdown]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3)
      .map((row) => ({ name: row.category, amount: row.amount }));

    return {
      incomeCount,
      expenseCount,
      avgIncomeAmount,
      avgExpenseAmount,
      profitMarginPct,
      topIncomeCategories,
      topExpenseCategories,
      biggestIncomeSources,
      biggestExpenseCategories,
    };
  }, [
    filteredTransactions,
    totals.income,
    totals.net,
    incomeBreakdown,
    expenseBreakdown,
    periodIncomeBreakdown,
    periodExpenseBreakdown,
  ]);

  const currentMonthKeyForPeriod = useMemo(() => {
    if (!selectedPeriod) return null;
    const d =
      selectedPeriod.mode === 'year'
        ? new Date(selectedPeriod.year, 11, 1)
        : new Date(selectedPeriod.year, selectedPeriod.month ?? 0, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
  }, [selectedPeriod]);

  const monthsOfNegativeProfit = useMemo(() => {
    if (!currentMonthKeyForPeriod) return 0;
    const upTo = allMonthSummaries.filter(
      (m) => m.monthKey <= currentMonthKeyForPeriod
    );
    let count = 0;
    for (let i = upTo.length - 1; i >= 0; i--) {
      if (upTo[i].net < 0) count++;
      else break;
    }
    return count;
  }, [allMonthSummaries, currentMonthKeyForPeriod]);

  const cashRunwayMonths = useMemo(() => {
    if (!currentMonthKeyForPeriod) return 0;
    if (cashBalanceAtEndOfPeriod <= 0) return 0;
    const upTo = allMonthSummaries.filter(
      (m) => m.monthKey <= currentMonthKeyForPeriod
    );
    const window = upTo.slice(-6); // last up to 6 months
    if (window.length === 0) return 0;
    const burns = window
      .map((m) => m.net)
      .filter((net) => net < 0)
      .map((net) => -net);
    if (burns.length === 0) return 0;
    const avgBurn = burns.reduce((s, v) => s + v, 0) / burns.length;
    if (avgBurn <= 0) return 0;
    return cashBalanceAtEndOfPeriod / avgBurn;
  }, [allMonthSummaries, currentMonthKeyForPeriod, cashBalanceAtEndOfPeriod]);

  const periodLabel = useMemo(() => {
    if (!selectedPeriod) return 'All time';
    if (selectedPeriod.mode === 'year') {
      return String(selectedPeriod.year);
    }
    const d = new Date(selectedPeriod.year, selectedPeriod.month ?? 0, 1);
    return d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
  }, [selectedPeriod]);

  // ---------- actions ----------

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function isValidIsoDate(s: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [yy, mm, dd] = s.split('-').map((x) => parseInt(x, 10));
    if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) {
      return false;
    }
    if (mm < 1 || mm > 12) return false;
    if (dd < 1 || dd > 31) return false;
    const d = new Date(yy, mm - 1, dd);
    return (
      d.getFullYear() === yy &&
      d.getMonth() === mm - 1 &&
      d.getDate() === dd
    );
  }

  function formatIsoDigitsOnly(input: string) {
    // Users can type numbers only; we auto-insert dashes for YYYY-MM-DD.
    const digits = input.replace(/[^\d]/g, '').slice(0, 8);
    const y = digits.slice(0, 4);
    const m = digits.slice(4, 6);
    const d = digits.slice(6, 8);
    if (digits.length <= 4) return y;
    if (digits.length <= 6) return `${y}-${m}`;
    return `${y}-${m}-${d}`;
  }

  function parseIsoOrNull(iso: string) {
    if (!isValidIsoDate(iso)) return null;
    const [yy, mm, dd] = iso.split('-').map((x) => parseInt(x, 10));
    return new Date(yy, mm - 1, dd);
  }

  function addDaysISO(iso: string, days: number) {
    const base = parseIsoOrNull(iso) ?? new Date();
    const dt = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    dt.setDate(dt.getDate() + days);
    return dt.toISOString().slice(0, 10);
  }

  function getRangeForPreset(preset: InsightPreset): { from: string; to: string } {
    const to = todayISO();
    if (preset === '30d') return { from: addDaysISO(to, -30), to };
    if (preset === '90d') return { from: addDaysISO(to, -90), to };
    if (preset === 'ytd') {
      const year = new Date().getFullYear();
      return { from: `${year}-01-01`, to };
    }
    // custom
    return {
      from: insightCustomFrom || addDaysISO(to, -30),
      to: insightCustomTo || to,
    };
  }

  function getPreviousRange(from: string, to: string): { from: string; to: string } {
    const fromD = parseIsoOrNull(from);
    const toD = parseIsoOrNull(to);
    if (!fromD || !toD) {
      const fallbackTo = todayISO();
      const fallbackFrom = addDaysISO(fallbackTo, -30);
      return { from: addDaysISO(fallbackFrom, -30), to: addDaysISO(fallbackFrom, -1) };
    }
    const days = Math.max(
      1,
      Math.round((toD.getTime() - fromD.getTime()) / (24 * 60 * 60 * 1000))
    );
    // previous window immediately before `from`
    const prevTo = addDaysISO(from, -1);
    const prevFrom = addDaysISO(prevTo, -days);
    return { from: prevFrom, to: prevTo };
  }

  function isPnLCategoryLocal(category: string) {
    const c = (category || '').toLowerCase();
    const nonPnL = [
      'owner contributions',
      'debt financing',
      'loans payable',
      'credit cards',
      'accounts payable',
      'equity investments',
      'long-term assets',
    ];
    return !nonPnL.some((k) => c.includes(k));
  }

  function computeWindowStats(
    txs: Transaction[],
    from: string,
    to: string
  ): {
    income: number;
    expenses: number;
    net: number;
    txCount: number;
    topIncomeCategories: Array<{ category: string; amount: number }>;
    topExpenseCategories: Array<{ category: string; amount: number }>;
  } {
    const incomeByCat = new Map<string, number>();
    const expenseByCat = new Map<string, number>();
    let income = 0;
    let expenses = 0;
    let txCount = 0;

    for (const tx of txs) {
      if (!tx.date) continue;
      if (tx.date < from || tx.date > to) continue;
      if (!isPnLCategoryLocal(tx.category)) continue;
      const amt = Number(tx.amount) || 0;
      if (amt === 0) continue;
      txCount += 1;
      const cat = tx.category || 'Uncategorized';
      if (amt > 0) {
        income += amt;
        incomeByCat.set(cat, (incomeByCat.get(cat) ?? 0) + amt);
      } else {
        const abs = Math.abs(amt);
        expenses += abs;
        expenseByCat.set(cat, (expenseByCat.get(cat) ?? 0) + abs);
      }
    }

    const topIncomeCategories = Array.from(incomeByCat.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    const topExpenseCategories = Array.from(expenseByCat.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    return { income, expenses, net: income - expenses, txCount, topIncomeCategories, topExpenseCategories };
  }

  async function loadInsightHistory() {
    setInsightsError(null);
    if (!aiInsightRunsEnabled) {
      setInsightRuns([]);
      setActiveInsightRunId(null);
      return;
    }
    if (!selectedBusinessId) {
      setInsightRuns([]);
      setActiveInsightRunId(null);
      return;
    }

    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user?.id;
    if (!userId) {
      setInsightRuns([]);
      setActiveInsightRunId(null);
      return;
    }

    const { data, error } = await supabase
      .from('ai_insight_runs')
      .select('id, created_at, user_id, business_id, preset, from_date, to_date, prompt, result')
      .eq('business_id', selectedBusinessId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      if (isMissingAiInsightRunsTable(error)) {
        disableAiInsightRunsQueries();
      }
      setInsightRuns([]);
      return;
    }

    const rows = (data ?? []) as any[];
    const mapped = rows.map((r) => ({
      id: String(r.id),
      created_at: String(r.created_at),
      user_id: String(r.user_id),
      business_id: String(r.business_id),
      preset: (r.preset as InsightPreset) ?? '30d',
      from_date: String(r.from_date),
      to_date: String(r.to_date),
      prompt: r.prompt ?? null,
      result: r.result as InsightRunResult,
    })) as InsightRunRow[];

    const normalized = normalizeInsightRuns(mapped);
    setInsightRuns(normalized);
    setActiveInsightRunId((prev) => {
      if (prev && normalized.some((r) => r.id === prev)) return prev;
      return normalized[0]?.id ?? null;
    });
  }

  useEffect(() => {
    void loadInsightHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusinessId, aiInsightRunsEnabled]);

  async function runInsightAnalysis(extraPrompt?: string) {
    setInsightsLoading(true);
    setInsightsError(null);
    try {
      if (!selectedBusinessId) {
        setInsightsError('Loading your business…');
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user?.id;
      if (!userId) {
        setInsightsError('Log in to run analysis.');
        return;
      }

      const { from, to } = getRangeForPreset(insightPreset);
      if (insightPreset === 'custom') {
        if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
          setInsightsError('Enter valid dates (numbers only). Format: YYYY-MM-DD.');
          return;
        }
        if (from > to) {
          setInsightsError('Start date must be before end date.');
          return;
        }
      }
      const prev = insightPreset === 'ytd'
        ? { from: `${new Date().getFullYear() - 1}-01-01`, to: addDaysISO(todayISO(), -365) }
        : getPreviousRange(from, to);

      const currentStats = computeWindowStats(transactions, from, to);
      const prevStats = computeWindowStats(transactions, prev.from, prev.to);

      const res = await fetch('/api/ai/analysis-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: 'My Business',
          from,
          to,
          current: {
            income: currentStats.income,
            expenses: currentStats.expenses,
            net: currentStats.net,
            txCount: currentStats.txCount,
          },
          previous: {
            income: prevStats.income,
            expenses: prevStats.expenses,
            net: prevStats.net,
            txCount: prevStats.txCount,
          },
          topIncomeCategories: currentStats.topIncomeCategories,
          topExpenseCategories: currentStats.topExpenseCategories,
          prompt: extraPrompt ?? '',
        }),
      });

      const body = (await res.json()) as any;
      if (!res.ok) {
        setInsightsError(body?.error ?? 'AI failed to run analysis.');
        return;
      }

      const result = body as InsightRunResult;

      // Persist run (best effort; if table isn't migrated yet, still show results in-session).
      let inserted: InsightRunRow | null = null;
      try {
        if (!aiInsightRunsEnabled) {
          throw new Error('ai_insight_runs_disabled');
        }
        // Deduplicate by date range: update existing run for the same range instead of inserting a new row.
        const { data: existing } = await supabase
          .from('ai_insight_runs')
          .select('id')
          .eq('business_id', selectedBusinessId)
          .eq('user_id', userId)
          .eq('from_date', from)
          .eq('to_date', to)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const basePayload: any = {
          user_id: userId,
          business_id: selectedBusinessId,
          preset: insightPreset,
          from_date: from,
          to_date: to,
          prompt: extraPrompt ?? null,
          result,
        };

        const saveQuery = existing?.id
          ? supabase
              .from('ai_insight_runs')
              .update(basePayload)
              .eq('id', existing.id)
          : supabase.from('ai_insight_runs').insert(basePayload);

        const { data: saved, error: saveError } = await saveQuery
          .select('id, created_at, user_id, business_id, preset, from_date, to_date, prompt, result')
          .single();

        if (!saveError && saved) {
          inserted = {
            id: String((saved as any).id),
            created_at: String((saved as any).created_at),
            user_id: String((saved as any).user_id),
            business_id: String((saved as any).business_id),
            preset: ((saved as any).preset as InsightPreset) ?? insightPreset,
            from_date: String((saved as any).from_date),
            to_date: String((saved as any).to_date),
            prompt: (saved as any).prompt ?? null,
            result: (saved as any).result as InsightRunResult,
          };
        }
        if (saveError && isMissingAiInsightRunsTable(saveError)) {
          disableAiInsightRunsQueries();
        }

        // Best-effort cleanup: keep only 5 unique ranges, delete older duplicates/extra rows.
        try {
          const { data: recentRows } = await supabase
            .from('ai_insight_runs')
            .select('id, created_at, from_date, to_date')
            .eq('business_id', selectedBusinessId)
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(50);

          const rows = (recentRows ?? []) as any[];
          const seen = new Set<string>();
          const keepIds: string[] = [];
          const deleteIds: string[] = [];
          for (const r of rows) {
            const key = `${String(r.from_date)}__${String(r.to_date)}`;
            const id = String(r.id);
            if (!seen.has(key) && keepIds.length < 5) {
              seen.add(key);
              keepIds.push(id);
            } else {
              deleteIds.push(id);
            }
          }
          if (deleteIds.length > 0) {
            await supabase.from('ai_insight_runs').delete().in('id', deleteIds);
          }
        } catch {
          // ignore cleanup errors
        }
      } catch {
        // ignore
      }

      if (inserted) {
        setInsightRuns((prevRuns) =>
          normalizeInsightRuns([
            inserted!,
            ...prevRuns.filter((r) => rangeKeyForRun(r) !== rangeKeyForRun(inserted!)),
          ])
        );
        setActiveInsightRunId(inserted.id);
      } else {
        // Local-only fallback
        const fallback: InsightRunRow = {
          id: `local-${Date.now()}`,
          created_at: new Date().toISOString(),
          user_id: userId,
          business_id: selectedBusinessId,
          preset: insightPreset,
          from_date: from,
          to_date: to,
          prompt: extraPrompt ?? null,
          result,
        };
        setInsightRuns((prevRuns) =>
          normalizeInsightRuns([
            fallback,
            ...prevRuns.filter((r) => rangeKeyForRun(r) !== rangeKeyForRun(fallback)),
          ])
        );
        setActiveInsightRunId(fallback.id);
      }
    } finally {
      setInsightsLoading(false);
    }
  }

  // Daily log functionality removed for now

  function handleImportClick() {
    setShowImport(true);
    setImportStage('idle');
    setImportColumns([]);
    setColumnMap({});
    setImportRows([]);
    setImportLog('');
    setMapError(null);
  }

  function handleAddFilesClick() {
    handleImportClick();
    fileRef.current?.click();
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null;
    setImportLog('');
    if (!file) return;
    setImportStage('parsing');

    if (file.name.endsWith('.csv')) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res: any) => {
          const rows = Array.isArray(res.data) ? (res.data as any[]) : [];
          const cols = Object.keys(rows[0] || {});
          setImportColumns(cols);
          setColumnMap(autoMapColumns(cols));
          setImportRows(rows);
          setImportStage('ready');
        },
        error: (err: any) => {
          setImportLog('Failed to parse CSV: ' + err.message);
          setImportStage('error');
        },
      });
    } else if (file.name.endsWith('.xlsx')) {
      const reader = new FileReader();
      reader.onload = function (ev) {
        const data = new Uint8Array(
          (ev.target as FileReader).result as ArrayBuffer
        );
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const parsed = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const rows = parsed as any[];
        const cols = Object.keys(rows[0] || {});
        setImportColumns(cols);
        setColumnMap(autoMapColumns(cols));
        setImportRows(rows);
        setImportStage('ready');
      };
      reader.onerror = function () {
        setImportLog('Failed to read Excel File');
        setImportStage('error');
      };
      reader.readAsArrayBuffer(file);
    } else {
      setImportLog('Unsupported file format. Please use .csv or .xlsx.');
      setImportStage('error');
    }
  }

  async function handleDoImport() {
    setMapError(null);
    setImportToast(null);

    // We auto-detect headers; the only requirement is an amount column.
    if (!isMappingValid(columnMap)) {
      setMapError(
        'We could not find an Amount column. Please ensure your file has a header like: amount, Amount, debit, credit, or value.'
      );
      setImportToast({
        kind: 'error',
        message: 'Import blocked: could not detect an Amount column.',
      });
      return;
    }

    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user?.id;
    if (!selectedBusinessId || !userId) {
      setMapError('Log in required to import.');
      setImportToast({ kind: 'error', message: 'Log in to import.' });
      return;
    }

    // eslint-disable-next-line no-console
    console.log('IMPORT_START', {
      businessId: selectedBusinessId,
      userId,
      rowCount: importRows.length,
      columns: importColumns,
    });

    setImportStage('importing');

    const todayISO = new Date().toISOString().split('T')[0];
    let skippedInvalid = 0;
    const skippedReasons = new Map<string, number>();
    const customerCol = (columnMap['customer'] || '').trim();

    // 1) Clean + map all rows
    const mappedRows = importRows
      .map((row) => {
        const rawDate = columnMap['date'] ? row[columnMap['date']] : null;
        const rawAmount = row[columnMap['amount']];

        // Amount is the ONLY hard requirement
        const amount = normalizeAmount(rawAmount);
        if (amount === null) {
          skippedInvalid += 1;
          skippedReasons.set(
            'missing_amount',
            (skippedReasons.get('missing_amount') ?? 0) + 1
          );
          return null;
        }

        // Date: try to normalize; if bad/missing, use today
        const normalizedDate = rawDate ? normalizeDate(rawDate) : null;
        const date = normalizedDate || todayISO;

        // Description: optional → default if missing/blank/unmapped
        const hasDescriptionColumn = !!columnMap['description'];
        const rawDescription = hasDescriptionColumn
          ? row[columnMap['description']]
          : '';
        const description = rawDescription
          ? String(rawDescription).trim()
          : 'Imported transaction';

        // Category: optional → normalize with fallback "Uncategorized"
        const hasCategoryColumn = !!columnMap['category'];
        const rawCategory = hasCategoryColumn
          ? row[columnMap['category']]
          : undefined;
        const category = normalizeCategory(rawCategory);

        const base = {
          date,
          description,
          category,
          amount,
          user_id: userId,
          business_id: selectedBusinessId,
          customer_id: null as string | null,
          _raw_customer: customerCol ? String(row[customerCol] ?? '').trim() : '',
        };

        return base;
      })
      .filter(Boolean) as {
        date: string;
        description: string;
        category: string;
        amount: number;
        user_id: string;
        business_id: string;
        customer_id: string | null;
        _raw_customer: string;
      }[];

    if (mappedRows.length === 0) {
      setImportLog(
        'No usable rows found. Every row was missing a valid amount. Check that your amount column is mapped correctly.'
      );
      setImportToast({
        kind: 'error',
        message: 'No usable rows found (missing Amount).',
      });
      setImportStage('done');
      return;
    }

    // eslint-disable-next-line no-console
    console.log('IMPORT_MAPPED', {
      mapped: mappedRows.length,
      skipped: skippedInvalid,
      businessId: selectedBusinessId,
    });

    // 1b) Optional: link customers
    if (customerCol) {
      try {
        const rawNames = Array.from(
          new Set(
            mappedRows
              .map((r) => (r._raw_customer || '').trim())
              .filter(Boolean)
              .slice(0, 500) // safety cap
          )
        );

        if (rawNames.length > 0) {
          // Load existing customers for this business
          const { data: existing, error: cErr } = await supabase
            .from('customers')
            .select('id, name')
            .eq('business_id', selectedBusinessId)
            ;

          if (cErr) {
            // eslint-disable-next-line no-console
            console.error('IMPORT_CUSTOMERS_LOAD_FAILED', cErr.message ?? cErr);
          } else {
            const byName = new Map<string, string>();
            for (const c of (existing ?? []) as any[]) {
              const nm = String(c.name ?? '').trim().toLowerCase();
              if (!nm) continue;
              byName.set(nm, String(c.id));
            }

            let created = 0;
            for (const nm of rawNames) {
              const key = nm.trim().toLowerCase();
              if (!key) continue;
              if (byName.has(key)) continue;

              const { data: ins, error: insErr } = await supabase
                .from('customers')
                .insert({
                  business_id: selectedBusinessId,
                  name: nm.trim(),
                  status: 'ACTIVE',
                  balance: 0,
                } as any)
                .select('id, name')
                .single();

              if (insErr) {
                // eslint-disable-next-line no-console
                console.error('IMPORT_CUSTOMER_CREATE_FAILED', insErr.message ?? insErr, nm);
                continue;
              }

              if (ins) {
                byName.set(String((ins as any).name ?? nm).trim().toLowerCase(), String((ins as any).id));
                created += 1;
              }
            }

            // Apply customer_id mapping to rows
            for (const r of mappedRows) {
              const key = (r._raw_customer || '').trim().toLowerCase();
              r.customer_id = key ? byName.get(key) ?? null : null;
            }

            // eslint-disable-next-line no-console
            console.log('IMPORT_CUSTOMER_LINKING', {
              detectedCustomerColumn: customerCol,
              uniqueNames: rawNames.length,
              created,
              linked: mappedRows.filter((r) => !!r.customer_id).length,
            });
          }
        }
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error('IMPORT_CUSTOMER_LINKING_UNEXPECTED', e);
      }
    }

    // 2) Insert in chunks, with row-level fallback on errors.
    // NOTE: We intentionally do NOT rely on `external_id` (column not present in Supabase).
    let imported = 0;
    let failed = 0;
    let lastErrorMessage: string | null = null;
    let firstFailedRow: any | null = null;
    let firstFailedError: string | null = null;

    for (let i = 0; i < mappedRows.length; i += 100) {
      const chunk = mappedRows.slice(i, i + 100).map((r) => {
        const { _raw_customer, ...rest } = r as any;
        return rest;
      });

      const { error } = await supabase.from('transactions').insert(chunk);

      if (!error) {
        imported += chunk.length;
        continue;
      }

      // If a batch fails (e.g., one bad row), fall back to per-row inserts
      // so we still import the good rows.
      lastErrorMessage = error.message ?? String(error);
      if (!firstFailedRow) {
        firstFailedRow = chunk[0] ?? null;
        firstFailedError = lastErrorMessage;
      }
      // eslint-disable-next-line no-console
      console.error('IMPORT_BATCH_FAILED', lastErrorMessage, firstFailedRow);
      for (const row of chunk) {
        const { error: rowError } = await supabase
          .from('transactions')
          .insert(row);
        if (rowError) {
          failed += 1;
          lastErrorMessage = rowError.message ?? String(rowError);
          if (!firstFailedRow) {
            firstFailedRow = row;
            firstFailedError = lastErrorMessage;
          }
          // eslint-disable-next-line no-console
          console.error('IMPORT_ROW_FAILED', lastErrorMessage, row);
        } else {
          imported += 1;
        }
      }
    }

    const parts: string[] = [];
    parts.push(`Imported ${imported}.`);
    parts.push(`Skipped ${skippedInvalid}.`);
    parts.push(`Failed ${failed}.`);
    if (skippedInvalid > 0) {
      const reasons: string[] = [];
      if ((skippedReasons.get('missing_amount') ?? 0) > 0) {
        reasons.push('missing Amount');
      }
      if (reasons.length) {
        parts.push(`Skip reasons: ${reasons.join(', ')}.`);
      }
    }
    if (lastErrorMessage) {
      parts.push(`Supabase error: ${lastErrorMessage}`);
      if (firstFailedError) {
        parts.push(`First failure: ${firstFailedError}`);
      }
    }

    setImportLog(parts.join(' '));
    setImportStage('done');

    setImportToast({
      kind: failed > 0 ? 'error' : 'success',
      message:
        failed > 0
          ? `Import finished with errors: Imported ${imported}, Skipped ${skippedInvalid}, Failed ${failed}.`
          : `Import successful: Imported ${imported}, Skipped ${skippedInvalid}.`,
    });

    // 4) Refresh cached transactions (no refetch-on-tab-switch; only after mutation).
    if (selectedBusinessId) {
      await queryClient.invalidateQueries({ queryKey: ['transactions', selectedBusinessId] });
    }

    // eslint-disable-next-line no-console
    console.log('IMPORT_DONE', { imported, skippedInvalid, failed });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function handleDownloadPDF(reportLabel: string) {
    if (!pdfRef.current) return;
    setPdfLoading(true);
    const canvas = await html2canvas(pdfRef.current, {
      backgroundColor: '#0f172a',
      scale: 2,
    });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'pt',
      format: 'a4',
    });
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
    pdf.save(
      `RevGuard-${reportLabel.replace(/\s+/g, '')}-${new Date()
        .toISOString()
        .slice(0, 7)}.pdf`
    );
    setPdfLoading(false);
  }

  // ---------- render ----------

  return (
    <div>
        {importToast && (
          <div className="fixed top-4 right-4 z-[60]">
            <div
              className={`rounded-2xl border px-4 py-3 shadow-xl backdrop-blur-sm max-w-[360px] ${
                importToast.kind === 'success'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-100'
              }`}
            >
              <div className="text-[11px] uppercase tracking-[0.18em] opacity-80">
                {importToast.kind === 'success' ? 'Import' : 'Import error'}
              </div>
              <div className="mt-1 text-sm">{importToast.message}</div>
            </div>
          </div>
        )}
        <header className="mb-4">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-50">
            RevGuard Dashboard
          </h1>
          <p className="mt-1 text-sm leading-snug text-slate-300">
            A simple view of what&apos;s coming in, what&apos;s going out, and what
            to fix first.
          </p>
        </header>
        {businessError && (
          <div className="mb-4 text-xs text-rose-300">{businessError}</div>
        )}
        {businessLoading && (
          <div className="mb-4 text-xs text-slate-400">Loading business…</div>
        )}

        {/* Import */}
        <div className="flex flex-wrap gap-3 items-center mb-6">
          <button
            type="button"
            onClick={handleAddFilesClick}
            className="ml-auto relative z-20 bg-slate-900 border border-blue-700/60 text-xs px-3 py-2 rounded-xl hover:border-blue-400"
          >
            Add files
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {/* Scenario + chart */}
        <section className="mb-8">

          {showScenario && (
            <div className="mb-4 px-4 py-5 bg-slate-950/80 rounded-2xl border border-blue-900/30 shadow shadow-blue-400/10 flex flex-col gap-3">
              <h3 className="text-sm font-bold text-blue-300 mb-2">
                Adjust Categories
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                {allCategories.map((cat) => (
                  <div key={cat} className="flex gap-2 items-center">
                    <label className="text-slate-200 w-20">{cat}</label>
                    <input
                      type="range"
                      min="-50"
                      max="100"
                      value={scenario[cat] ?? 0}
                      onChange={(e) =>
                        setScenario((s) => ({
                          ...s,
                          [cat]: +e.target.value,
                        }))
                      }
                      className="flex-1 accent-blue-400"
                    />
                    <span
                      className={
                        (scenario[cat] ?? 0) === 0
                          ? 'text-blue-100'
                          : (scenario[cat] ?? 0) > 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }
                    >
                      {scenario[cat]
                        ? `${scenario[cat]! > 0 ? '+' : ''}${scenario[cat]}%`
                        : '0%'}
                    </span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setScenarioActive(true)}
                className="mt-3 bg-gradient-to-tr from-emerald-600 via-blue-600 to-blue-500 text-white px-5 py-2 rounded-xl font-bold shadow hover:scale-105 transition"
              >
                Run Scenario
              </button>
            </div>
          )}

          {/* Header for the cash chart area */}
          <div className="flex justify-between items-center mb-2 text-[11px] text-slate-300">
            <span>Cash overview</span>
          </div>

          <div className="grid md:grid-cols-[2fr,1.1fr] gap-4 items-stretch">
            <div>
              <CashBarChart
                key={`${selectedBusinessId ?? 'no-biz'}-${selectedPeriod?.mode ?? 'month'}-${chartBounds.start}-${chartBounds.end}-${range}-${selectedYear ?? 'u'}-${selectedMonth ?? 'u'}`}
                // IMPORTANT: CashBarChart needs the full (business-scoped) tx list so it can
                // compute available years and make Prev/Next year navigation work.
                // Passing a range/year-filtered list can collapse `years` to a single year,
                // making the buttons appear broken.
                transactions={plotted}
                selectedPeriod={selectedPeriod}
                onPeriodChange={handleCashChartPeriodChange}
                loading={isTxLoading}
                animationKey={`${range}`}
              />
              {chartPoints.length > 0 && (
                <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 text-[11px] text-slate-200">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-slate-300 font-semibold">
                      Recent periods
                    </span>
                    <span className="text-slate-500">
                      Last {Math.min(chartPoints.length, 6)} of{' '}
                      {chartPoints.length}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead>
                        <tr className="text-[10px] text-slate-400">
                          <th className="text-left pr-2 py-1">Period</th>
                          <th className="text-right px-2 py-1">Income</th>
                          <th className="text-right px-2 py-1">Expenses</th>
                          <th className="text-right px-2 py-1">Net</th>
                          <th className="text-right pl-2 py-1">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chartPoints
                          .slice(-6)
                          .map((p) => p)
                          .reverse()
                          .map((p) => (
                            <tr
                              key={p.txId ?? p.x.toISOString()}
                              className="border-t border-slate-800/70"
                            >
                              <td className="pr-2 py-1 text-slate-200">
                                {p.x.toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </td>
                              <td className="px-2 py-1 text-right text-emerald-300">
                                {p.amount >= 0
                                  ? formatCurrency(p.amount)
                                  : formatCurrency(0)}
                              </td>
                              <td className="px-2 py-1 text-right text-rose-300">
                                {p.amount < 0
                                  ? formatCurrency(p.amount)
                                  : formatCurrency(0)}
                              </td>
                              <td
                                className={`px-2 py-1 text-right ${
                                  p.amount >= 0
                                    ? 'text-emerald-300'
                                    : 'text-rose-300'
                                }`}
                              >
                                {formatCurrency(p.amount)}
                              </td>
                              <td className="pl-2 py-1 text-right text-blue-200">
                                {formatCurrency(p.y)}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2 text-xs">
              <MetricCard
                label="Cash balance"
                value={cashBalanceAtEndOfPeriod}
                positive={cashBalanceAtEndOfPeriod >= 0}
                highlight
              />
              <MetricCard
                label={`Income (${selectedYearForStatements ?? 'year'})`}
                value={statementTotals.income}
              />
              <MetricCard
                label={`Expenses (${selectedYearForStatements ?? 'year'})`}
                value={-statementTotals.expenses}
              />
              <MetricCard
                label={`Net profit (${selectedYearForStatements ?? 'year'})`}
                value={statementTotals.net}
                positive={statementTotals.net >= 0}
              />

            </div>
          </div>

        </section>

        {/* AI analysis */}
        <section className="mb-8">
          <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-4 min-h-[140px] text-xs space-y-3">
            <div className="flex items-center justify-between mb-1">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">
                  AI Insights
                </h3>
                <p className="text-[11px] text-slate-500">
                  Run analysis for a specific window and revisit past runs anytime.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void runInsightAnalysis()}
                disabled={insightsLoading || !selectedBusinessId}
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
              >
                {insightsLoading ? 'Running…' : 'Run analysis'}
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {/* Filters */}
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {([
                    { id: '30d', label: '30d' },
                    { id: '90d', label: '90d' },
                    { id: 'ytd', label: 'YTD' },
                    { id: 'custom', label: 'Custom' },
                  ] as const).map((p) => {
                    const active = insightPreset === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setInsightPreset(p.id)}
                        className={`rounded-full border px-3 py-1 text-[11px] transition ${
                          active
                            ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200'
                            : 'border-slate-700 bg-slate-950/30 text-slate-200 hover:border-slate-500'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>

                {insightPreset === 'custom' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={insightCustomFrom}
                      onChange={(e) =>
                        setInsightCustomFrom(formatIsoDigitsOnly(e.target.value))
                      }
                      onBlur={(e) => {
                        const v = formatIsoDigitsOnly(e.target.value);
                        setInsightCustomFrom(v);
                        if (v && !isValidIsoDate(v)) {
                          setInsightsError('Invalid start date. Use YYYY-MM-DD.');
                        }
                      }}
                      inputMode="numeric"
                      placeholder="From (YYYYMMDD)"
                      className="w-36 rounded-lg border border-slate-700 bg-slate-950/40 px-2 py-1 text-[11px] text-slate-100"
                    />
                    <span className="text-[11px] text-slate-500">→</span>
                    <input
                      value={insightCustomTo}
                      onChange={(e) =>
                        setInsightCustomTo(formatIsoDigitsOnly(e.target.value))
                      }
                      onBlur={(e) => {
                        const v = formatIsoDigitsOnly(e.target.value);
                        setInsightCustomTo(v);
                        if (v && !isValidIsoDate(v)) {
                          setInsightsError('Invalid end date. Use YYYY-MM-DD.');
                        }
                      }}
                      inputMode="numeric"
                      placeholder="To (YYYYMMDD)"
                      className="w-36 rounded-lg border border-slate-700 bg-slate-950/40 px-2 py-1 text-[11px] text-slate-100"
                    />
                  </div>
                )}
              </div>

              {/* Output */}
              {insightsError && (
                <div className="text-[11px] text-rose-300">{insightsError}</div>
              )}

              {(() => {
                const active =
                  insightRuns.find((r) => r.id === activeInsightRunId) ??
                  insightRuns[0] ??
                  null;

                if (insightsLoading) {
                  return (
                    <div className="text-[11px] text-slate-400">
                      Running analysis…
                    </div>
                  );
                }

                if (!active) {
                  return (
                    <div className="text-[11px] text-slate-400">
                      Choose a window and click{' '}
                      <span className="text-emerald-200 font-semibold">
                        Run analysis
                      </span>
                      . Your runs will appear here.
                    </div>
                  );
                }

                return (
                  <div className="space-y-3">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                      <div className="text-[11px] text-slate-400">
                        {active.from_date} → {active.to_date}{' '}
                        <span className="text-slate-600">•</span>{' '}
                        {new Date(active.created_at).toLocaleString('en-US')}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(active.result.follow_ups ?? []).slice(0, 3).map((f) => (
                          <button
                            key={f.label}
                            type="button"
                            onClick={() => void runInsightAnalysis(f.prompt)}
                            disabled={insightsLoading}
                            className="rounded-full border border-slate-700 bg-slate-950/30 px-3 py-1 text-[11px] text-slate-200 hover:border-slate-500 disabled:opacity-50"
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid md:grid-cols-3 gap-3">
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                          What Changed
                        </div>
                        <ul className="mt-2 space-y-1 text-[12px] text-slate-200">
                          {active.result.what_changed.map((t, i) => (
                            <li key={i}>• {t}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                          Top Drivers
                        </div>
                        <ul className="mt-2 space-y-1 text-[12px] text-slate-200">
                          {active.result.top_drivers.map((t, i) => (
                            <li key={i}>• {t}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                          Next Actions
                        </div>
                        <ul className="mt-2 space-y-1 text-[12px] text-slate-200">
                          {active.result.next_actions.map((t, i) => (
                            <li key={i}>• {t}</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {insightRuns.length > 1 && (
                      <div className="pt-2 border-t border-slate-800/80">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-2">
                          History
                        </div>
                        <div className="flex flex-col gap-1">
                          {insightRuns.slice(0, 5).map((r) => {
                            const isActive = r.id === active.id;
                            return (
                              <button
                                key={r.id}
                                type="button"
                                onClick={() => setActiveInsightRunId(r.id)}
                                className={`text-left rounded-xl border px-3 py-2 text-[11px] transition ${
                                  isActive
                                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                                    : 'border-slate-800 bg-slate-950/20 text-slate-200 hover:border-slate-600'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate">
                                    {r.from_date} → {r.to_date}
                                  </span>
                                  <span className="text-slate-500">
                                    {new Date(r.created_at).toLocaleDateString('en-US')}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </section>

        {/* Financial statements */}
        <section className="mb-8 bg-slate-950/80 border border-slate-800 rounded-2xl p-4 text-xs">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-3 gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                Financial Statements
              </h3>
              <p className="text-[11px] text-slate-400">
                {selectedYearForStatements
                  ? `Based on all transactions in ${selectedYearForStatements}.`
                  : 'No transactions yet.'}
              </p>
              {isStatementsLoading && (
                <p className="text-[11px] text-slate-500 mt-1">
                  Loading statement data…
                </p>
              )}
              {statementsError && (
                <p className="text-[11px] text-rose-300 mt-1">
                  {statementsError}
                </p>
              )}
            </div>
            <div className="flex flex-col items-start md:items-end gap-1">
              <div className="flex gap-1">
                <FilterButton
                  label="Income"
                  active={selectedStatement === 'income'}
                  onClick={() => setSelectedStatement('income')}
                />
                <FilterButton
                  label="Balance Sheet"
                  active={selectedStatement === 'balance'}
                  onClick={() => setSelectedStatement('balance')}
                />
                <FilterButton
                  label="Cash Flow"
                  active={selectedStatement === 'cashflow'}
                  onClick={() => setSelectedStatement('cashflow')}
                />
              </div>
            </div>
          </div>

          {selectedStatement === 'income' && (
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <IncomeStatementCard
                  transactions={statementTransactions as any}
                />
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <h5 className="text-[11px] font-semibold text-slate-300 mb-1 uppercase tracking-wide">
                    Income by Category
                  </h5>
                  <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 max-h-40 overflow-y-auto">
                    {statementIncomeBreakdown.length === 0 ? (
                      <p className="text-slate-400 text-[11px]">
                        No income in this range yet.
                      </p>
                    ) : (
                      <ul className="space-y-0.5">
                        {statementIncomeBreakdown.map((row) => {
                          const share =
                            statementTotals.income > 0
                              ? (row.amount / statementTotals.income) * 100
                              : 0;
                          return (
                          <li
                            key={row.category}
                            className="flex justify-between"
                          >
                            <span className="text-slate-300">
                              {row.category}
                            </span>
                            <span className="text-emerald-300 font-semibold">
                              {formatCurrency(row.amount)}{' '}
                              {statementTotals.income > 0 && (
                                <span className="text-[10px] text-slate-400">
                                  ({share.toFixed(1)}%)
                                </span>
                              )}
                            </span>
                          </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
                <div>
                  <h5 className="text-[11px] font-semibold text-slate-300 mb-1 uppercase tracking-wide">
                    Expenses by Category
                  </h5>
                  <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 max-h-40 overflow-y-auto">
                    {statementExpenseBreakdown.length === 0 ? (
                      <p className="text-slate-400 text-[11px]">
                        No expenses in this range yet.
                      </p>
                    ) : (
                      <ul className="space-y-0.5">
                        {statementExpenseBreakdown.map((row) => {
                          const share =
                            statementTotals.expenses > 0
                              ? (row.amount / statementTotals.expenses) * 100
                              : 0;
                          return (
                          <li
                            key={row.category}
                            className="flex justify-between"
                          >
                            <span className="text-slate-300">
                              {row.category}
                            </span>
                            <span className="text-rose-300 font-semibold">
                              {formatCurrency(-row.amount)}{' '}
                              {statementTotals.expenses > 0 && (
                                <span className="text-[10px] text-slate-400">
                                  ({share.toFixed(1)}%)
                                </span>
                              )}
                            </span>
                          </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {selectedStatement === 'balance' && (
            <div className="grid md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <BalanceSheetCard
                  transactions={statementTransactions as any}
                />
              </div>
              <div className="md:col-span-1">
                <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 text-[11px] text-slate-300 space-y-1.5">
                  <h4 className="text-[11px] font-semibold text-slate-300 mb-1 uppercase tracking-wide">
                    How to read this
                  </h4>
                  <p>
                    This simple balance view estimates assets, liabilities, and
                    equity directly from your transactions. As you categorize
                    more items as assets, loans, or equity movements, this view
                    will get more accurate.
                  </p>
                </div>
              </div>
            </div>
          )}

          {selectedStatement === 'cashflow' && (
            <div className="grid md:grid-cols-2 gap-4">
              <CashFlowCard transactions={statementTransactions as any} />
              <div>
                <h4 className="text-[11px] font-semibold text-slate-300 mb-1 uppercase tracking-wide">
                  How to read this
                </h4>
                <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 text-[11px] text-slate-300 space-y-1.5">
                  <p>
                    This cash flow view groups movements into operating,
                    investing, and financing. Today most CSV imports will show
                    up as operating until you explicitly tag asset purchases or
                    financing activity.
                  </p>
                  <p>
                    Positive net cash change means your cash position improved
                    over this period; negative means you burned more cash than
                    you brought in.
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Import modal */}
        {showImport && (
          <section className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-slate-950 border border-slate-700 rounded-2xl p-5 w-full max-w-lg text-xs">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-semibold text-slate-100">
                  Import Transactions
                </h3>
                <button
                  type="button"
                  onClick={() => setShowImport(false)}
                  className="text-slate-400 hover:text-slate-100"
                >
                  ✕
                </button>
              </div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-[11px] text-slate-300">
                  Upload a <span className="text-slate-100 font-semibold">.csv</span> or{' '}
                  <span className="text-slate-100 font-semibold">.xlsx</span>.
                </div>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="px-3 py-2 rounded-xl border border-slate-700 bg-slate-900 text-slate-100 hover:border-blue-400"
                >
                  Choose file
                </button>
              </div>
              {importStage === 'parsing' && (
                <div className="mb-3 text-[11px] text-slate-300">
                  Parsing file…
                </div>
              )}

              {importStage === 'ready' && (
                <div className="mb-3">
                  <div className="text-[11px] text-slate-300">
                    Ready to import{' '}
                    <span className="text-slate-100 font-semibold">
                      {importRows.length.toLocaleString('en-US')}
                    </span>{' '}
                    rows.
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    Required: Amount. Defaults: Date = today, Category =
                    Uncategorized, Description = “Imported transaction”.
                  </div>

                  {mapError && (
                    <p className="mt-2 text-rose-300 text-[11px]">{mapError}</p>
                  )}

                  <button
                    type="button"
                    onClick={handleDoImport}
                    disabled={!selectedBusinessId}
                    className="mt-3 px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Import
                  </button>

                  {!selectedBusinessId && !businessLoading && (
                    <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-5 text-center">
                      <div className="text-sm font-semibold text-slate-100">
                        Sign in required
                      </div>
                      <div className="mt-1 text-[11px] text-slate-400">
                        Log in to import transactions into your account.
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          router.push(
                            `/login?redirect=${encodeURIComponent(
                              '/transactions'
                            )}`
                          )
                        }
                        className="mt-4 w-full rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
                      >
                        Log in
                      </button>
                      <div className="mt-3 text-[11px] text-slate-400">
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              `/signup?redirect=${encodeURIComponent(
                                '/transactions'
                              )}`
                            )
                          }
                          className="text-emerald-200 hover:text-emerald-100"
                        >
                          Create account
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {importLog && (
                <p className="mt-2 text-slate-200 whitespace-pre-wrap">
                  {importLog}
                </p>
              )}
            </div>
          </section>
        )}
        <div ref={pdfRef} className="hidden" />
      </div>
  );
}

// ---------- UI helpers ----------

function MetricCard({
  label,
  value,
  positive,
  highlight,
  clickable,
  selected,
  onClick,
}: {
  label: string;
  value: number;
  positive?: boolean;
  highlight?: boolean;
  clickable?: boolean;
  selected?: boolean;
  onClick?: () => void;
}) {
  const formatted = formatCurrency(value);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-2xl border p-4 w-full transition ${
        highlight
          ? 'border-emerald-500/40 bg-gradient-to-br from-emerald-500/10 to-slate-900'
          : 'border-slate-800 bg-slate-900'
      } ${
        clickable
          ? 'hover:border-blue-400 hover:bg-slate-900/70 cursor-pointer'
          : 'cursor-default'
      } ${selected ? 'ring-2 ring-blue-500' : ''}`}
    >
      <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">
        {label}
      </p>
      <p
        className={`text-xl font-semibold ${
          positive ?? value >= 0 ? 'text-emerald-400' : 'text-slate-50'
        }`}
      >
        {formatted}
      </p>
    </button>
  );
}

function FilterButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs border transition ${
        active
          ? 'bg-blue-500 text-white border-blue-500'
          : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-blue-400'
      }`}
    >
      {label}
    </button>
  );
}

function CashLineChart() {
  // Deprecated chart; left as a noop to avoid breaking imports while
  // the new CashBarChart is used instead.
  return null;
}
