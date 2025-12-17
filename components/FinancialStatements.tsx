'use client';

import React, { useMemo, useState } from 'react';
import { computeStatements, type Transaction } from '../lib/computeStatements';
import { formatCurrency } from '../lib/formatCurrency';

type Props = {
  transactions: Transaction[]; // all transactions for current business
};

export default function FinancialStatements({ transactions }: Props) {
  // derive available years from transactions
  const years = useMemo(() => {
    const s = Array.from(
      new Set(transactions.map((t) => new Date(t.date).getFullYear()))
    );
    return s.sort((a, b) => a - b);
  }, [transactions]);

  // default selected year = latest (or 'all')
  const [selectedYear, setSelectedYear] = useState<number | 'all' | null>(
    years.length > 0 ? years[years.length - 1] : 'all'
  );

  // small period toggle - month/year/all; uses selectedYear/year-month combos
  const [periodMode, setPeriodMode] = useState<'month' | 'year' | 'all'>(
    'all'
  );

  // anchorDate is latest transaction date (used if you use month mode)
  const anchorDate = useMemo(() => {
    if (!transactions || transactions.length === 0) return null;
    const sorted = [...transactions].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    return new Date(sorted[0].date);
  }, [transactions]);

  // compute effectiveYear: if selectedYear === 'all' -> 'all'; else number
  const effectiveYear =
    selectedYear === 'all' || selectedYear === null ? 'all' : selectedYear;

  // choose transactions filtered by periodMode and selectedYear/anchorDate
  const filteredTransactions = useMemo(() => {
    if (!transactions || transactions.length === 0) return [];

    if (periodMode === 'all') return transactions;

    if (periodMode === 'year') {
      if (effectiveYear === 'all') {
        // if no explicit year selected, use anchor year if available
        const anchorYear = anchorDate ? anchorDate.getFullYear() : null;
        return anchorYear
          ? transactions.filter(
              (tx) => new Date(tx.date).getFullYear() === anchorYear
            )
          : transactions;
      }
      return transactions.filter(
        (tx) => new Date(tx.date).getFullYear() === (effectiveYear as number)
      );
    }

    // periodMode === 'month'
    const targetYear =
      effectiveYear === 'all'
        ? anchorDate
          ? anchorDate.getFullYear()
          : null
        : (effectiveYear as number);
    if (!targetYear) return [];
    const targetMonth = anchorDate ? anchorDate.getMonth() : 0;
    return transactions.filter((tx) => {
      const d = new Date(tx.date);
      return d.getFullYear() === targetYear && d.getMonth() === targetMonth;
    });
  }, [transactions, periodMode, anchorDate, effectiveYear]);

  const summary = useMemo(
    () =>
      computeStatements(filteredTransactions, {
        year: effectiveYear === 'all' ? 'all' : (effectiveYear as number),
      }),
    [filteredTransactions, effectiveYear]
  );

  // UI handlers
  const currentIndex = years.indexOf(
    selectedYear === 'all'
      ? years[years.length - 1] ?? new Date().getFullYear()
      : (selectedYear as number)
  );

  return (
    <div className="rounded-xl bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-100">
            Financial Statements
          </h3>
          <p className="text-xs text-slate-400">
            {periodMode === 'all'
              ? 'Based on all time transactions.'
              : periodMode === 'year'
              ? `Based on transactions in ${
                  effectiveYear === 'all' ? 'all years' : effectiveYear
                }.`
              : anchorDate
              ? `Based on ${anchorDate.toLocaleString('en-US', {
                  month: 'long',
                  year: 'numeric',
                })}.`
              : 'No transactions.'}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          {/* Period toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setPeriodMode('month')}
              className={`rounded-full px-3 py-1 text-xs ${
                periodMode === 'month'
                  ? 'bg-cyan-500 text-slate-900'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              This month
            </button>
            <button
              onClick={() => setPeriodMode('year')}
              className={`rounded-full px-3 py-1 text-xs ${
                periodMode === 'year'
                  ? 'bg-cyan-500 text-slate-900'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              This year
            </button>
            <button
              onClick={() => setPeriodMode('all')}
              className={`rounded-full px-3 py-1 text-xs ${
                periodMode === 'all'
                  ? 'bg-cyan-500 text-slate-900'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              All
            </button>
          </div>

          {/* Year navigation */}
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => {
                if (years.length === 0) return;
                const idx = Math.max(0, currentIndex - 1);
                setSelectedYear(years[idx]);
              }}
              className="rounded-md bg-slate-800 px-2 py-1 disabled:opacity-40"
              disabled={currentIndex <= 0}
            >
              ‹
            </button>

            <select
              value={selectedYear ?? 'all'}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedYear(v === 'all' ? 'all' : Number(v));
              }}
              className="bg-slate-800 text-xs rounded px-2 py-1"
            >
              <option value="all">All years</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>

            <button
              onClick={() => {
                if (years.length === 0) return;
                const idx = Math.min(years.length - 1, currentIndex + 1);
                setSelectedYear(years[idx]);
              }}
              className="rounded-md bg-slate-800 px-2 py-1 disabled:opacity-40"
              disabled={currentIndex >= years.length - 1}
            >
              ›
            </button>

            <button
              onClick={() =>
                setSelectedYear(years[years.length - 1] ?? 'all')
              }
              className="text-xs text-slate-400 ml-2"
            >
              Jump to latest
            </button>
          </div>
        </div>
      </div>

      {/* Three cards */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-slate-300">
        {/* Income Statement */}
        <div className="rounded-md bg-slate-800 p-4">
          <h4 className="text-sm text-slate-200 font-semibold">
            Income Statement
          </h4>
          <div className="mt-3 space-y-1.5">
            <div className="flex justify-between">
              <span>Total income</span>
              <span>
                {formatCurrency(summary.incomeStatement.totalIncome)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Total expenses</span>
              <span>
                {formatCurrency(-summary.incomeStatement.totalExpenses)}
              </span>
            </div>
            <div className="mt-2 border-t border-slate-700 pt-2 font-semibold flex justify-between">
              <span>Net income</span>
              <span
                className={
                  summary.incomeStatement.netIncome >= 0
                    ? 'text-emerald-400'
                    : 'text-rose-400'
                }
              >
                {formatCurrency(summary.incomeStatement.netIncome)}
              </span>
            </div>
          </div>
        </div>

        {/* Balance Sheet */}
        <div className="rounded-md bg-slate-800 p-4">
          <h4 className="text-sm text-slate-200 font-semibold">
            Balance Sheet
          </h4>
          <div className="mt-3 space-y-1.5">
            <div className="flex justify-between">
              <span>Assets</span>
              <span>{formatCurrency(summary.balanceSheet.assets)}</span>
            </div>
            <div className="flex justify-between">
              <span>Liabilities</span>
              <span className="text-rose-300">
                {formatCurrency(-summary.balanceSheet.liabilities)}
              </span>
            </div>
            <div className="mt-2 border-t border-slate-700 pt-2 font-semibold flex justify-between">
              <span>Equity</span>
              <span>{formatCurrency(summary.balanceSheet.equity)}</span>
            </div>
          </div>
        </div>

        {/* Cash Flow */}
        <div className="rounded-md bg-slate-800 p-4">
          <h4 className="text-sm text-slate-200 font-semibold">
            Cash Flow
          </h4>
          <div className="mt-3 space-y-1.5">
            <div className="flex justify-between">
              <span>Operating</span>
              <span>{formatCurrency(summary.cashFlow.operating)}</span>
            </div>
            <div className="flex justify-between">
              <span>Investing</span>
              <span>{formatCurrency(summary.cashFlow.investing)}</span>
            </div>
            <div className="flex justify-between">
              <span>Financing</span>
              <span>{formatCurrency(summary.cashFlow.financing)}</span>
            </div>
            <div className="mt-2 border-t border-slate-700 pt-2 font-semibold flex justify-between">
              <span>Net change</span>
              <span
                className={
                  summary.cashFlow.netChange >= 0
                    ? 'text-emerald-400'
                    : 'text-rose-400'
                }
              >
                {formatCurrency(summary.cashFlow.netChange)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}