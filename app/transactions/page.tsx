'use client';

// Very simple Transactions tab for RevGuard.
// - Lists transactions from Supabase
// - Lets you create, edit, and delete a single transaction at a time
// - Optional client-side search by description

import React, { useMemo, useState } from 'react';
import { supabase } from '../../utils/supabaseClient';
import { useQueryClient } from '@tanstack/react-query';
import { useAppData } from '../../components/AppDataProvider';

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

  // 1) Apply search + income/expense filter
  const filteredTransactions = transactions.filter((tx) => {
    const matchesSearch = tx.description
      .toLowerCase()
      .includes(search.toLowerCase());

    const matchesFlow =
      flowFilter === 'all' ||
      (flowFilter === 'income' && tx.amount > 0) ||
      (flowFilter === 'expenses' && tx.amount < 0);

    return matchesSearch && matchesFlow;
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
    <main className="space-y-5">
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

        {/* Toolbar: New button + search + income/expense chips */}
        <section className="flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            type="button"
            onClick={openCreateForm}
            className="inline-flex items-center justify-center px-3 py-2 rounded-lg bg-emerald-500 text-slate-950 text-xs font-semibold hover:bg-emerald-400"
          >
            + New Transaction
          </button>

          <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search description..."
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500"
            />

            {/* Simple All / Income / Expenses filter chips */}
            <div className="flex items-center gap-1 text-[11px]">
              {(['all', 'income', 'expenses'] as FlowFilter[]).map((f) => {
                const label =
                  f === 'all' ? 'All' : f === 'income' ? 'Income' : 'Expenses';
                const active = flowFilter === f;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => {
                      setFlowFilter(f);
                      setCurrentPage(1);
                    }}
                    className={`px-2.5 py-1 rounded-full border text-[11px] ${
                      active
                        ? 'bg-slate-700 text-slate-50 border-slate-500'
                        : 'bg-slate-900 text-slate-200 border-slate-700 hover:border-emerald-400'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Table / list */}
        <section className="bg-slate-950/80 border border-slate-800 rounded-2xl p-3 text-xs">
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
                  <thead className="bg-slate-900 text-slate-300">
                    <tr>
                      <th
                        onClick={() => handleSort('date')}
                        className="cursor-pointer select-none px-3 py-2 text-left text-[11px] font-semibold text-slate-200"
                      >
                        Date{' '}
                        {sortKey === 'date' &&
                          (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th
                        onClick={() => handleSort('description')}
                        className="cursor-pointer select-none px-3 py-2 text-left text-[11px] font-semibold text-slate-200"
                      >
                        Description{' '}
                        {sortKey === 'description' &&
                          (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th
                        onClick={() => handleSort('category')}
                        className="cursor-pointer select-none px-3 py-2 text-left text-[11px] font-semibold text-slate-200"
                      >
                        Category{' '}
                        {sortKey === 'category' &&
                          (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th
                        onClick={() => handleSort('amount')}
                        className="cursor-pointer select-none px-3 py-2 text-right text-[11px] font-semibold text-slate-200"
                      >
                        Amount{' '}
                        {sortKey === 'amount' &&
                          (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th className="px-3 py-2 text-right text-[11px] font-semibold text-slate-200">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedTransactions.map((tx, idx) => {
                    const isNegative = tx.amount < 0;
                    const amountClass = isNegative
                      ? 'text-rose-300'
                      : 'text-emerald-300';
                    const rowBg =
                      idx % 2 === 0
                        ? 'bg-slate-950'
                        : 'bg-slate-900/80';

                      return (
                        <tr
                          key={tx.id}
                          className={`${rowBg} border-t border-slate-800 hover:bg-slate-800/80`}
                        >
                          <td className="px-3 py-2 align-top whitespace-nowrap">
                            {tx.date}
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="max-w-xs truncate">
                              {tx.description}
                            </div>
                          </td>
                          <td className="px-3 py-2 align-top">
                            {tx.category || '—'}
                          </td>
                          <td className="px-3 py-2 align-top text-right">
                            <span className={amountClass}>
                              {isNegative ? '-' : '+'}$
                              {Math.abs(tx.amount).toFixed(2)}
                            </span>
                          </td>
                          <td className="px-3 py-2 align-top text-right space-x-2">
                            <button
                              type="button"
                              onClick={() => openEditForm(tx)}
                              className="text-[11px] text-sky-300 hover:text-sky-100"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete(tx)}
                              className="text-[11px] text-rose-300 hover:text-rose-100"
                            >
                              Delete
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

// How to use:
// - Navigate to /transactions (the sidebar link in AppLayout already points here).
// - Click "+ New Transaction" to open the form, fill in the fields, and hit "Create".
// - Use the "Edit" button in a row to change an existing transaction and save.
// - Use the "Delete" button to remove a transaction after confirming in the dialog.



