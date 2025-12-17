'use client';

import React, { useMemo, useState } from 'react';
import type {
  Transaction,
  TransactionStatus,
} from '../types/transactions';

type SortKey = 'date' | 'amount' | 'type';
type SortDirection = 'asc' | 'desc';

interface BulkState {
  selectedIds: Set<string>;
}

interface Props {
  rows: Transaction[];
  loading: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onEdit: (tx: Transaction) => void;
  onInlineUpdate: (
    id: string,
    patch: Partial<Pick<Transaction, 'category' | 'status' | 'account'>>
  ) => Promise<void>;
  onBulkAction: (
    action: 'mark-cleared' | 'mark-reconciled' | 'change-category' | 'delete',
    ids: string[],
    extra?: { category?: string }
  ) => Promise<void>;
}

export function TransactionTable({
  rows,
  loading,
  error,
  page,
  pageSize,
  onPageChange,
  onEdit,
  onInlineUpdate,
  onBulkAction,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [bulk, setBulk] = useState<BulkState>({ selectedIds: new Set() });
  const [categoryForBulk, setCategoryForBulk] = useState('');

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      let vA: number | string = '';
      let vB: number | string = '';

      if (sortKey === 'date') {
        vA = a.date;
        vB = b.date;
      } else if (sortKey === 'amount') {
        vA = a.amount;
        vB = b.amount;
      } else if (sortKey === 'type') {
        vA = a.type ?? '';
        vB = b.type ?? '';
      }

      if (vA < vB) return sortDir === 'asc' ? -1 : 1;
      if (vA > vB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  function toggleSort(key: SortKey) {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((prevDir) => (prevDir === 'asc' ? 'desc' : 'asc'));
        return prevKey;
      }
      setSortDir('asc');
      return key;
    });
  }

  function toggleRow(id: string) {
    setBulk((prev) => {
      const next = new Set(prev.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next };
    });
  }

  function toggleAll(checked: boolean) {
    if (!checked) {
      setBulk({ selectedIds: new Set() });
      return;
    }
    setBulk({ selectedIds: new Set(paged.map((r) => r.id)) });
  }

  const selectedCount = bulk.selectedIds.size;

  async function handleBulk(action: 'mark-cleared' | 'mark-reconciled' | 'change-category' | 'delete') {
    if (!selectedCount) return;
    const ids = Array.from(bulk.selectedIds.values());
    if (action === 'delete') {
      const ok = window.confirm(
        `Delete ${ids.length} selected transaction${ids.length > 1 ? 's' : ''}? This cannot be undone.`
      );
      if (!ok) return;
    }
    if (action === 'change-category') {
      if (!categoryForBulk.trim()) return;
    }
    await onBulkAction(action, ids, {
      category: action === 'change-category' ? categoryForBulk.trim() : undefined,
    });
    setBulk({ selectedIds: new Set() });
    setCategoryForBulk('');
  }

  async function handleInlineStatus(id: string, value: string) {
    await onInlineUpdate(id, { status: value as TransactionStatus });
  }

  async function handleInlineCategory(id: string, value: string) {
    await onInlineUpdate(id, { category: value || null });
  }

  async function handleInlineAccount(id: string, value: string) {
    await onInlineUpdate(id, { account: value || null });
  }

  return (
    <section className="bg-slate-950/80 border border-slate-800 rounded-2xl p-3 text-xs">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-slate-100">
          Ledger ({rows.length} transactions)
        </h2>
        <div className="flex items-center gap-3 text-[11px]">
          {loading && <span className="text-slate-400">Loading…</span>}
          {error && <span className="text-rose-300">{error}</span>}
        </div>
      </div>

      {/* Bulk actions */}
      {selectedCount > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] bg-slate-900/80 border border-slate-700 rounded-lg px-2 py-1.5">
          <span className="text-slate-300">
            {selectedCount} selected
          </span>
          <button
            type="button"
            onClick={() => handleBulk('mark-cleared')}
            className="px-2 py-0.5 rounded border border-slate-600 text-slate-100 hover:border-emerald-400"
          >
            Mark cleared
          </button>
          <button
            type="button"
            onClick={() => handleBulk('mark-reconciled')}
            className="px-2 py-0.5 rounded border border-slate-600 text-slate-100 hover:border-sky-400"
          >
            Mark reconciled
          </button>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={categoryForBulk}
              onChange={(e) => setCategoryForBulk(e.target.value)}
              placeholder="Set category…"
              className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-[11px]"
            />
            <button
              type="button"
              onClick={() => handleBulk('change-category')}
              className="px-2 py-0.5 rounded border border-emerald-500 text-emerald-200 hover:bg-emerald-500/10"
            >
              Apply to selected
            </button>
          </div>
          <button
            type="button"
            onClick={() => handleBulk('delete')}
            className="px-2 py-0.5 rounded border border-rose-500 text-rose-300 hover:bg-rose-500/10 ml-auto"
          >
            Delete selected
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-800/80">
        <table className="min-w-full text-[11px]">
          <thead className="bg-slate-900/90 text-slate-300 sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2 text-left">
                <input
                  type="checkbox"
                  checked={
                    paged.length > 0 &&
                    paged.every((r) => bulk.selectedIds.has(r.id))
                  }
                  onChange={(e) => toggleAll(e.target.checked)}
                />
              </th>
              <SortableHeader
                label="Date"
                active={sortKey === 'date'}
                direction={sortDir}
                onClick={() => toggleSort('date')}
              />
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-left">Category</th>
              <th className="px-3 py-2 text-left hidden sm:table-cell">Account</th>
              <SortableHeader
                label="Amount"
                active={sortKey === 'amount'}
                direction={sortDir}
                alignRight
                onClick={() => toggleSort('amount')}
              />
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left hidden sm:table-cell">Source</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-4 text-center text-slate-400"
                >
                  No transactions match these filters yet.
                </td>
              </tr>
            ) : (
              paged.map((tx) => {
                const amount = tx.amount ?? 0;
                const isOutflow =
                  tx.type === 'expense' || tx.type === 'liability' || amount < 0;
                const displayAmount = Math.abs(amount).toFixed(2);

                return (
                  <tr
                    key={tx.id}
                    className="odd:bg-slate-950/60 even:bg-slate-900/60 border-t border-slate-800/60 hover:bg-slate-800/60"
                  >
                    <td className="px-3 py-2 align-top">
                      <input
                        type="checkbox"
                        checked={bulk.selectedIds.has(tx.id)}
                        onChange={() => toggleRow(tx.id)}
                      />
                    </td>
                    <td className="px-3 py-2 align-top whitespace-nowrap text-slate-200">
                      {tx.date}
                    </td>
                    <td className="px-3 py-2 align-top text-slate-200">
                      {tx.type ?? (amount >= 0 ? 'income' : 'expense')}
                    </td>
                    <td className="px-3 py-2 align-top text-slate-100">
                      <div className="max-w-xs truncate">{tx.description}</div>
                      {tx.notes && (
                        <div className="text-[10px] text-slate-500 truncate">
                          {tx.notes}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-slate-200">
                      <input
                        type="text"
                        value={tx.category ?? ''}
                        onChange={(e) =>
                          handleInlineCategory(tx.id, e.target.value)
                        }
                        className="w-full bg-transparent border border-transparent hover:border-slate-700 rounded px-1 py-0.5 focus:outline-none focus:border-emerald-400"
                      />
                    </td>
                    <td className="px-3 py-2 align-top text-slate-200 hidden sm:table-cell">
                      <input
                        type="text"
                        value={tx.account ?? ''}
                        onChange={(e) =>
                          handleInlineAccount(tx.id, e.target.value)
                        }
                        className="w-full bg-transparent border border-transparent hover:border-slate-700 rounded px-1 py-0.5 focus:outline-none focus:border-emerald-400"
                      />
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      <span
                        className={`font-semibold ${
                          isOutflow ? 'text-rose-300' : 'text-emerald-300'
                        }`}
                      >
                        {isOutflow ? '-' : '+'}${displayAmount}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <select
                        value={tx.status ?? ''}
                        onChange={(e) =>
                          handleInlineStatus(tx.id, e.target.value)
                        }
                        className="bg-slate-900 border border-slate-700 rounded-full px-2 py-0.5 text-[10px] text-slate-100"
                      >
                        <option value="">—</option>
                        <option value="cleared">Cleared</option>
                        <option value="pending">Pending</option>
                        <option value="reconciled">Reconciled</option>
                      </select>
                    </td>
                    <td className="px-3 py-2 align-top text-slate-400 hidden sm:table-cell">
                      {tx.source ?? 'manual'}
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      <button
                        type="button"
                        onClick={() => onEdit(tx)}
                        className="text-[11px] text-sky-300 hover:text-sky-100 mr-2"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onBulkAction('delete', [tx.id])}
                        className="text-[11px] text-rose-300 hover:text-rose-100"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300">
        <div>Rows per page: 25</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-2 py-0.5 rounded border border-slate-700 disabled:opacity-40"
          >
            &lt; Prev
          </button>
          <div className="flex items-center gap-1">
            {Array.from({ length: totalPages }).map((_, idx) => {
              const p = idx + 1;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPageChange(p)}
                  className={`w-6 h-6 rounded text-center border text-[11px] ${
                    p === page
                      ? 'bg-slate-100 text-slate-900 border-slate-100'
                      : 'border-slate-700 text-slate-300 hover:border-emerald-400'
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="px-2 py-0.5 rounded border border-slate-700 disabled:opacity-40"
          >
            Next &gt;
          </button>
        </div>
      </div>
    </section>
  );
}

interface SortableHeaderProps {
  label: string;
  active: boolean;
  direction: SortDirection;
  alignRight?: boolean;
  onClick: () => void;
}

function SortableHeader({
  label,
  active,
  direction,
  alignRight,
  onClick,
}: SortableHeaderProps) {
  return (
    <th
      className={`px-3 py-2 text-left cursor-pointer select-none ${
        alignRight ? 'text-right' : 'text-left'
      }`}
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className="text-[9px] text-slate-500">
          {active ? (direction === 'asc' ? '▲' : '▼') : '▴▾'}
        </span>
      </span>
    </th>
  );
}


