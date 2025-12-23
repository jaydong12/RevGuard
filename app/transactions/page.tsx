'use client';

// Very simple Transactions tab for RevGuard.
// - Lists transactions from Supabase
// - Lets you create, edit, and delete a single transaction at a time
// - Optional client-side search by description

import React, { useMemo, useState } from 'react';
import { supabase } from '../../utils/supabaseClient';
import { useQueryClient } from '@tanstack/react-query';
import { useAppData } from '../../components/AppDataProvider';
import { formatCurrency } from '../../lib/formatCurrency';
import {
  Calendar,
  FilterX,
  Pencil,
  Search,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';

const CATEGORIES = [
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

  'Other',
] as const;

// Basic transaction shape for this page.
// Matches the existing Supabase "transactions" table.
type Transaction = {
  id: number;
  date: string; // ISO date (YYYY-MM-DD)
  description: string;
  category: string;
  amount: number; // positive = income, negative = expense
  customer_id?: string | null;
  business_id?: string | null;
};

// Form state for creating / editing a transaction.
type TransactionFormState = {
  date: string;
  description: string;
  category: string;
  amount: string; // keep as string for easier input handling
  customer_id: string; // '' means none selected
  flow: 'income' | 'expense';
};

type FormMode = 'create' | 'edit';

// Sorting + simple income/expense filter
type SortKey = 'date' | 'description' | 'category' | 'amount';
type SortDirection = 'asc' | 'desc';
type FlowFilter = 'all' | 'income' | 'expenses';

export default function TransactionsPage() {
  // ---------- basic state ----------

  const queryClient = useQueryClient();
  const {
    userId,
    businessId: selectedBusinessId,
    loading: businessLoading,
    error: businessError,
    transactions: transactionsRaw,
    customers: customersRaw,
  } = useAppData();

  const transactions = (transactionsRaw as any[]) as Transaction[];
  const loading = businessLoading;
  const error = businessError;

  // Simple client-side search by description.
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');

  // Client-side sort state.
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Simple income / expense filter.
  const [flowFilter, setFlowFilter] = useState<FlowFilter>('all');

  // Client-side pagination.
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Form / modal state.
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>('create');
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [formValues, setFormValues] = useState<TransactionFormState>({
    date: '',
    description: '',
    category: '',
    amount: '',
    customer_id: '',
    flow: 'expense',
  });
  const [formError, setFormError] = useState<string | null>(null);

  const customersLoading = false;
  const customersError: string | null = null;
  const customers = useMemo(() => {
    const rows = (customersRaw as any[]) ?? [];
    return rows.map((c: any) => ({
      id: String(c.id),
      name: String(c.name ?? 'Unnamed customer'),
    }));
  }, [customersRaw]);

  // ---------- helpers for the form ----------

  function openCreateForm() {
    setFormMode('create');
    setEditingTx(null);
    setFormValues({
      date: '',
      description: '',
      category: '',
      amount: '',
      customer_id: '',
      flow: 'expense',
    });
    setFormError(null);
    setFormOpen(true);
  }

  function openEditForm(tx: Transaction) {
    setFormMode('edit');
    setEditingTx(tx);
    setFormValues({
      date: tx.date ?? '',
      description: tx.description ?? '',
      category: tx.category ?? '',
      amount: String(Math.abs(tx.amount ?? 0)),
      customer_id: tx.customer_id ?? '',
      flow: (tx.amount ?? 0) < 0 ? 'expense' : 'income',
    });
    setFormError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingTx(null);
    setFormError(null);
  }

  function handleFormChange<K extends keyof TransactionFormState>(
    key: K,
    value: TransactionFormState[K]
  ) {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  }

  // ---------- create / edit / delete ----------

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Basic validation
    if (!formValues.date.trim()) {
      setFormError('Date is required.');
      return;
    }
    if (!formValues.description.trim()) {
      setFormError('Description is required.');
      return;
    }
    if (!formValues.amount.trim() || Number.isNaN(Number(formValues.amount))) {
      setFormError('Amount is required and must be a number.');
      return;
    }
    if (!selectedBusinessId) {
      setFormError('Loading your business…');
      return;
    }

    const rawAmount = Number(formValues.amount);
    const absAmount = Number.isFinite(rawAmount) ? Math.abs(rawAmount) : NaN;
    const amountNumber =
      formValues.flow === 'expense' ? -absAmount : absAmount;
    const customerIdToSave = formValues.customer_id.trim() || null;

    try {
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user?.id ?? null;
      if (!userId) {
        setFormError('Please log in to create transactions.');
        return;
      }

      if (formMode === 'create') {
        // Insert a new transaction.
        const { data: inserted, error } = await supabase
          .from('transactions')
          .insert({
            date: formValues.date,
            description: formValues.description,
            category: formValues.category,
            amount: amountNumber,
            customer_id: customerIdToSave,
            business_id: selectedBusinessId,
          })
          .select('*')
          .single();

        if (error) {
          // eslint-disable-next-line no-console
          console.error('TX_CREATE_ERROR', error);
          setFormError(error.message ?? 'Could not create transaction.');
          return;
        }

        await queryClient.invalidateQueries({
          queryKey: ['transactions', selectedBusinessId],
        });
      } else if (formMode === 'edit' && editingTx) {
        const { data: updated, error } = await supabase
          .from('transactions')
          .update({
            date: formValues.date,
            description: formValues.description,
            category: formValues.category,
            amount: amountNumber,
            customer_id: customerIdToSave,
          })
          .eq('id', editingTx.id)
          .eq('business_id', selectedBusinessId)
          .select('*')
          .single();

        if (error) {
          // eslint-disable-next-line no-console
          console.error('TX_UPDATE_ERROR', error);
          setFormError(error.message ?? 'Could not update transaction.');
          return;
        }

        await queryClient.invalidateQueries({
          queryKey: ['transactions', selectedBusinessId],
        });
      }

      // On success: close the form and refresh the list
      closeForm();
    } catch {
      setFormError('Something went wrong. Please try again.');
    }
  }

  async function handleDelete(tx: Transaction) {
    const ok = window.confirm(
      'Are you sure you want to delete this transaction?'
    );
    if (!ok) return;

    try {
      if (!selectedBusinessId) {
        alert('Loading your business…');
        return;
      }

      const userIdToUse = userId ?? null;
      if (!userIdToUse) {
        alert('Please log in to delete transactions.');
        return;
      }

      const { error } = await supabase
        .from('transactions')
        .delete()
        .eq('id', tx.id)
        .eq('business_id', selectedBusinessId)
        ;

      if (error) {
        alert('Could not delete transaction. Please try again.');
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: ['transactions', selectedBusinessId],
      });
    } catch {
      alert('Could not delete transaction. Please try again.');
    }
  }

  // ---------- client-side filter + sort + pagination ----------

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of CATEGORIES) set.add(c);
    for (const tx of transactions) {
      const v = String(tx.category ?? '').trim();
      if (v) set.add(v);
    }
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
  }, [transactions]);

  const hasActiveFilters =
    Boolean(search.trim()) ||
    Boolean(dateFrom) ||
    Boolean(dateTo) ||
    Boolean(flowFilter !== 'all') ||
    Boolean(categoryFilter.trim()) ||
    Boolean(amountMin.trim()) ||
    Boolean(amountMax.trim());

  function clearFilters() {
    setSearch('');
    setDateFrom('');
    setDateTo('');
    setFlowFilter('all');
    setCategoryFilter('');
    setAmountMin('');
    setAmountMax('');
    setCurrentPage(1);
  }

  // 1) Apply filters
  const filteredTransactions = transactions.filter((tx) => {
    const hay = `${tx.description ?? ''} ${tx.category ?? ''}`.toLowerCase();
    const matchesSearch = !search.trim() || hay.includes(search.trim().toLowerCase());

    const matchesFlow =
      flowFilter === 'all' ||
      (flowFilter === 'income' && tx.amount > 0) ||
      (flowFilter === 'expenses' && tx.amount < 0);

    const matchesCategory =
      !categoryFilter.trim() ||
      String(tx.category ?? '').trim().toLowerCase() === categoryFilter.trim().toLowerCase();

    const matchesDateFrom = !dateFrom || (tx.date ?? '') >= dateFrom;
    const matchesDateTo = !dateTo || (tx.date ?? '') <= dateTo;

    const absAmt = Math.abs(Number(tx.amount) || 0);
    const min = Number(amountMin);
    const max = Number(amountMax);
    const matchesMin = !amountMin.trim() || (!Number.isNaN(min) && absAmt >= min);
    const matchesMax = !amountMax.trim() || (!Number.isNaN(max) && absAmt <= max);

    return (
      matchesSearch &&
      matchesFlow &&
      matchesCategory &&
      matchesDateFrom &&
      matchesDateTo &&
      matchesMin &&
      matchesMax
    );
  });

  // 2) Sort the filtered list client-side
  const sortedTransactions = [...filteredTransactions].sort((a, b) => {
    let cmp = 0;

    if (sortKey === 'date') {
      const aTime = new Date(a.date).getTime();
      const bTime = new Date(b.date).getTime();
      cmp = aTime - bTime;
    } else if (sortKey === 'amount') {
      cmp = a.amount - b.amount;
    } else if (sortKey === 'description') {
      const aVal = a.description.toLowerCase();
      const bVal = b.description.toLowerCase();
      cmp = aVal.localeCompare(bVal);
    } else if (sortKey === 'category') {
      const aVal = (a.category || '').toLowerCase();
      const bVal = (b.category || '').toLowerCase();
      cmp = aVal.localeCompare(bVal);
    }

    return sortDirection === 'asc' ? cmp : -cmp;
  });

  const totalRows = sortedTransactions.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedTransactions = sortedTransactions.slice(
    startIndex,
    startIndex + pageSize
  );
  const showingFrom = totalRows === 0 ? 0 : startIndex + 1;
  const showingTo = Math.min(startIndex + pageSize, totalRows);

  // Helper to update sort state when clicking headers.
  function handleSort(key: SortKey) {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        // Toggle direction when clicking the same column.
        setSortDirection((prevDir) =>
          prevDir === 'asc' ? 'desc' : 'asc'
        );
        return prevKey;
      }

      // New column: sensible defaults (desc for numbers/dates, asc for text).
      setSortDirection(
        key === 'date' || key === 'amount' ? 'desc' : 'asc'
      );
      return key;
    });
    setCurrentPage(1);
  }

  // ---------- render ----------

  return (
    <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Transactions
            </h1>
            <p className="text-slate-400 text-sm">
              View and manage your transactions for this business.
            </p>
          </div>
        </header>

        {businessError && <div className="text-xs text-rose-300">{businessError}</div>}
        {businessLoading && <div className="text-xs text-slate-400">Loading business…</div>}

        {/* Filter bar */}
        <section className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4 shadow-[0_1px_0_rgba(255,255,255,0.04)]">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400 flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-slate-400" />
                  Filters
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={openCreateForm}
                  className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
                >
                  + New
                </button>
                <button
                  type="button"
                  onClick={clearFilters}
                  disabled={!hasActiveFilters}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <FilterX className="h-4 w-4" />
                  Clear
                </button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-12">
              {/* Search */}
              <div className="md:col-span-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setCurrentPage(1);
                    }}
                    placeholder="Search description or category…"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-9 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                </div>
              </div>

              {/* Date range */}
              <div className="md:col-span-3 grid grid-cols-2 gap-2">
                <div className="relative">
                  <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => {
                      setDateFrom(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    aria-label="From date"
                  />
                </div>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  aria-label="To date"
                />
              </div>

              {/* Income/Expense */}
              <div className="md:col-span-2">
                <div className="grid grid-cols-3 rounded-xl border border-white/10 bg-white/5 p-1 text-[11px]">
                  {(['all', 'income', 'expenses'] as FlowFilter[]).map((f) => {
                    const label = f === 'all' ? 'All' : f === 'income' ? 'Income' : 'Expense';
                    const active = flowFilter === f;
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => {
                          setFlowFilter(f);
                          setCurrentPage(1);
                        }}
                        className={`rounded-lg py-1.5 font-semibold transition ${
                          active
                            ? 'bg-white/10 text-slate-50'
                            : 'text-slate-300 hover:bg-white/5'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Category */}
              <div className="md:col-span-2">
                <select
                  value={categoryFilter}
                  onChange={(e) => {
                    setCategoryFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                >
                  <option value="">All categories</option>
                  {categoryOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Amount range */}
              <div className="md:col-span-1 grid grid-cols-2 gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="Min"
                  value={amountMin}
                  onChange={(e) => {
                    setAmountMin(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="Max"
                  value={amountMax}
                  onChange={(e) => {
                    setAmountMax(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Table / list */}
        <section className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-3 shadow-[0_1px_0_rgba(255,255,255,0.04)]">
          {loading ? (
            <p className="text-slate-400">Loading transactions...</p>
          ) : error ? (
            <p className="text-rose-300">{error}</p>
          ) : filteredTransactions.length === 0 ? (
            <p className="text-slate-400">
              No transactions yet. Add one using the button above or import a
              CSV elsewhere.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left">
                  <thead className="bg-slate-950/60 text-slate-300 sticky top-0 z-10 backdrop-blur border-b border-white/10">
                    <tr>
                      <th
                        onClick={() => handleSort('date')}
                        className="cursor-pointer select-none px-4 py-3 text-left text-[11px] font-semibold text-slate-200"
                      >
                        Date{' '}
                        {sortKey === 'date' &&
                          (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th
                        onClick={() => handleSort('description')}
                        className="cursor-pointer select-none px-4 py-3 text-left text-[11px] font-semibold text-slate-200"
                      >
                        Description{' '}
                        {sortKey === 'description' &&
                          (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th
                        onClick={() => handleSort('category')}
                        className="cursor-pointer select-none px-4 py-3 text-left text-[11px] font-semibold text-slate-200"
                      >
                        Category{' '}
                        {sortKey === 'category' &&
                          (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th
                        onClick={() => handleSort('amount')}
                        className="cursor-pointer select-none px-4 py-3 text-right text-[11px] font-semibold text-slate-200"
                      >
                        Amount{' '}
                        {sortKey === 'amount' &&
                          (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold text-slate-200">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedTransactions.map((tx, idx) => {
                    const isNegative = tx.amount < 0;
                    const amountClass = isNegative ? 'text-rose-300' : 'text-emerald-300';
                    const rowBg = idx % 2 === 0 ? 'bg-white/[0.02]' : 'bg-white/[0.04]';
                    const cat = String(tx.category ?? '').trim() || 'Uncategorized';
                    const dateObj = new Date(tx.date);
                    const dateLabel = Number.isNaN(dateObj.getTime())
                      ? tx.date
                      : dateObj.toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        });

                      return (
                        <tr
                          key={tx.id}
                          className={`group ${rowBg} border-t border-white/10 hover:bg-white/[0.06] transition-colors`}
                        >
                          <td className="px-4 py-3 align-top whitespace-nowrap text-slate-300">
                            <div className="text-[11px]">{dateLabel}</div>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <div className="max-w-[520px]">
                              <div className="text-sm font-semibold text-slate-100 truncate">
                                {tx.description || '—'}
                              </div>
                              <div className="mt-1 text-[11px] text-slate-400">
                                {isNegative ? 'Expense' : 'Income'}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-200">
                              {cat}
                            </span>
                          </td>
                          <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                            <div className={`text-sm font-semibold ${amountClass}`}>
                              {isNegative ? '-' : '+'}
                              {formatCurrency(Math.abs(tx.amount))}
                            </div>
                          </td>
                          <td className="px-4 py-3 align-top text-right">
                            <button
                              type="button"
                              onClick={() => openEditForm(tx)}
                              className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 p-2 text-slate-200 opacity-0 group-hover:opacity-100 hover:bg-white/10 transition"
                              aria-label="Edit"
                              title="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete(tx)}
                              className="ml-2 inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 p-2 text-rose-200 opacity-0 group-hover:opacity-100 hover:bg-white/10 transition"
                              aria-label="Delete"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Simple client-side pagination controls */}
              <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-[11px] text-slate-300">
                <div>
                  Rows per page:
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="ml-2 rounded bg-slate-800 px-2 py-1 border border-slate-700"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span>
                    Showing {showingFrom}-{showingTo} of {totalRows}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setCurrentPage((p) => Math.max(1, p - 1))
                      }
                      disabled={currentPage === 1}
                      className="rounded px-2 py-1 border border-slate-700 disabled:opacity-40"
                    >
                      ‹ Prev
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setCurrentPage((p) => Math.min(totalPages, p + 1))
                      }
                      disabled={currentPage === totalPages}
                      className="rounded px-2 py-1 border border-slate-700 disabled:opacity-40"
                    >
                      Next ›
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>

        {/* Simple modal for create / edit */}
        {formOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="w-full max-w-md bg-slate-950 border border-slate-800 rounded-2xl p-5 text-xs shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">
                    {formMode === 'create'
                      ? 'New Transaction'
                      : 'Edit Transaction'}
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    {formMode === 'create'
                      ? 'Fill in the details below to add a transaction.'
                      : 'Update the details and save your changes.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeForm}
                  className="text-slate-500 hover:text-slate-100"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleFormSubmit} className="space-y-3">
                {formError && (
                  <p className="text-[11px] text-rose-300">{formError}</p>
                )}

                <div className="space-y-1">
                  <label className="block text-[11px] text-slate-300">
                    Date<span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="date"
                    value={formValues.date}
                    onChange={(e) => handleFormChange('date', e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] text-slate-300">
                    Description<span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formValues.description}
                    onChange={(e) =>
                      handleFormChange('description', e.target.value)
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px]"
                    placeholder="What was this for?"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] text-slate-300">
                    Category
                  </label>
                  <select
                    value={formValues.category}
                    onChange={(e) => handleFormChange('category', e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-100"
                  >
                    <option value="">Uncategorized</option>
                    {/* Preserve any legacy category values without overwriting on edit */}
                    {formValues.category &&
                      formValues.category.trim() &&
                      !(CATEGORIES as readonly string[]).includes(
                        formValues.category.trim()
                      ) && (
                        <option value={formValues.category}>
                          {formValues.category} (Legacy)
                        </option>
                      )}
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-500">
                    Pick a category for cleaner reports.
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] text-slate-300">
                    Customer
                  </label>
                  <select
                    value={formValues.customer_id}
                    onChange={(e) =>
                      handleFormChange('customer_id', e.target.value)
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-100"
                    disabled={!selectedBusinessId || customersLoading}
                  >
                    <option value="">
                      {customersLoading
                        ? 'Loading customers…'
                        : 'None (Unknown Customer)'
                      }
                    </option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {customersError && (
                    <p className="text-[11px] text-rose-300">
                      {customersError}
                    </p>
                  )}
                  <p className="text-[10px] text-slate-500">
                    If not selected, reports will show “Unknown Customer (Needs Review)” for revenue.
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] text-slate-300">
                    Type<span className="text-rose-400">*</span>
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleFormChange('flow', 'income')}
                      className={`flex-1 rounded-lg border px-3 py-2 text-[11px] font-semibold transition ${
                        formValues.flow === 'income'
                          ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
                          : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-emerald-400/60'
                      }`}
                    >
                      Income
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFormChange('flow', 'expense')}
                      className={`flex-1 rounded-lg border px-3 py-2 text-[11px] font-semibold transition ${
                        formValues.flow === 'expense'
                          ? 'border-rose-500/60 bg-rose-500/10 text-rose-200'
                          : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-rose-400/60'
                      }`}
                    >
                      Expense
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    We’ll save Income as <span className="text-emerald-300">positive</span>{' '}
                    and Expense as <span className="text-rose-300">negative</span> automatically.
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] text-slate-300">
                    Amount<span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formValues.amount}
                    onChange={(e) =>
                      handleFormChange('amount', e.target.value)
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px]"
                    placeholder="Enter amount (no minus sign needed)"
                  />
                  <p className="text-[10px] text-slate-500">
                    Saved as{' '}
                    <span
                      className={
                        formValues.flow === 'expense'
                          ? 'text-rose-300 font-semibold'
                          : 'text-emerald-300 font-semibold'
                      }
                    >
                      {(() => {
                        const n = Number(formValues.amount);
                        if (!Number.isFinite(n)) return '—';
                        const abs = Math.abs(n);
                        const signed = formValues.flow === 'expense' ? -abs : abs;
                        return `${signed < 0 ? '-' : '+'}$${Math.abs(signed).toFixed(2)}`;
                      })()}
                    </span>
                  </p>
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeForm}
                    className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-200 text-[11px]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 text-[11px] font-semibold hover:bg-emerald-400"
                  >
                    {formMode === 'create' ? 'Create' : 'Save changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
    </main>
  );
}
