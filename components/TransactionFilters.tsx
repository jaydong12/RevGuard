'use client';

import React from 'react';
import type { TransactionKind, TransactionStatus } from '../types/transactions';

export type HighLevelType =
  | 'all'
  | 'income'
  | 'expense'
  | 'transfer'
  | 'asset'
  | 'liability';

export type DateRangePreset =
  | 'this-month'
  | 'last-month'
  | 'this-year'
  | 'last-year'
  | 'custom';

export interface TransactionFilterState {
  typeTab: HighLevelType;
  datePreset: DateRangePreset;
  from?: string;
  to?: string;
  category: string | 'all';
  status: TransactionStatus | 'all';
  search: string;
}

interface Props {
  state: TransactionFilterState;
  categories: string[];
  onChange: (patch: Partial<TransactionFilterState>) => void;
}

export function TransactionFilters({ state, categories, onChange }: Props) {
  const {
    typeTab,
    datePreset,
    from,
    to,
    category,
    status,
    search,
  } = state;

  const typeTabs: { key: HighLevelType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'income', label: 'Income' },
    { key: 'expense', label: 'Expenses' },
    { key: 'transfer', label: 'Transfers' },
    { key: 'asset', label: 'Assets' },
    { key: 'liability', label: 'Liabilities' },
  ];

  const dateOptions: { key: DateRangePreset; label: string }[] = [
    { key: 'this-month', label: 'This month' },
    { key: 'last-month', label: 'Last month' },
    { key: 'this-year', label: 'This year' },
    { key: 'last-year', label: 'Last year' },
    { key: 'custom', label: 'Custom' },
  ];

  return (
    <section className="bg-slate-950/80 border border-slate-800 rounded-2xl p-3 text-xs space-y-3">
      {/* Type tabs */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-[11px] text-slate-400">Show:</span>
        <div className="flex flex-wrap gap-1">
          {typeTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onChange({ typeTab: tab.key })}
              className={`px-2.5 py-1 rounded-full border text-[11px] ${
                typeTab === tab.key
                  ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                  : 'bg-slate-900 text-slate-200 border-slate-700 hover:border-emerald-400'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Row 2: date + category + status */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-slate-400">Date:</span>
          <select
            value={datePreset}
            onChange={(e) =>
              onChange({ datePreset: e.target.value as DateRangePreset })
            }
            className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px]"
          >
            {dateOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
          {datePreset === 'custom' && (
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={from ?? ''}
                onChange={(e) => onChange({ from: e.target.value })}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px]"
              />
              <span className="text-[11px] text-slate-400">to</span>
              <input
                type="date"
                value={to ?? ''}
                onChange={(e) => onChange({ to: e.target.value })}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px]"
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <span className="text-[11px] text-slate-400">Category:</span>
          <select
            value={category}
            onChange={(e) => onChange({ category: e.target.value })}
            className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px]"
          >
            <option value="all">All</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1">
          <span className="text-[11px] text-slate-400">Status:</span>
          <select
            value={status}
            onChange={(e) =>
              onChange({ status: e.target.value as TransactionStatus | 'all' })
            }
            className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px]"
          >
            <option value="all">All</option>
            <option value="cleared">Cleared</option>
            <option value="pending">Pending</option>
            <option value="reconciled">Reconciled</option>
          </select>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => onChange({ search: e.target.value })}
          placeholder="Search description, category, or account"
          className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-[11px] placeholder:text-slate-500"
        />
      </div>
    </section>
  );
}


