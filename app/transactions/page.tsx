'use client';

// Very simple Transactions tab for RevGuard.
// - Lists transactions from Supabase
// - Lets you create, edit, and delete a single transaction at a time
// - Optional client-side search by description

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '../../utils/supabaseClient';
import { useQueryClient } from '@tanstack/react-query';
import { useAppData } from '../../components/AppDataProvider';
import { formatCurrency } from '../../lib/formatCurrency';
import { useToast } from '../../components/ToastProvider';
import { TAX_FEATURES_ENABLED } from '../../lib/featureFlags';
import { BottomSheet } from '../../components/mobile/BottomSheet';
import { MobileFab } from '../../components/mobile/MobileFab';
import {
  Calendar,
  FilterX,
  Pencil,
  Search,
  SlidersHorizontal,
  Tag,
  RotateCw,
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
  amount: number | string | null; // must be numeric on new writes; legacy rows may be null/string
  customer_id?: string | null;
  business_id?: string | null;
  tax_category?: string | null;
  tax_treatment?: string | null;
  confidence_score?: number | null;
  tax_reason?: string | null;
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
  const sp = useSearchParams();
  // ---------- basic state ----------

  const queryClient = useQueryClient();
  const { pushToast } = useToast();
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
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Date filter: store ISO internally (YYYY-MM-DD) for filtering, but allow typing MM/DD/YYYY.
  const [dateFromIso, setDateFromIso] = useState('');
  const [dateToIso, setDateToIso] = useState('');
  const [dateFromDisplay, setDateFromDisplay] = useState('');
  const [dateToDisplay, setDateToDisplay] = useState('');
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

  const [taxModalOpen, setTaxModalOpen] = useState(false);
  const [taxTx, setTaxTx] = useState<Transaction | null>(null);
  const [taxCategory, setTaxCategory] = useState<string>('uncategorized');
  const [taxTreatment, setTaxTreatment] = useState<string>('review');
  const [taxReason, setTaxReason] = useState<string>('');
  const [taxSaving, setTaxSaving] = useState(false);
  const [taxError, setTaxError] = useState<string | null>(null);

  const TAX_CATEGORY_OPTIONS: Array<{ value: string; label: string; help: string }> = [
    { value: 'gross_receipts', label: 'Income', help: 'Money coming in from customers.' },
    { value: 'sales_tax_collected', label: 'Sales tax collected', help: 'Tax you collected (not income).' },
    { value: 'sales_tax_paid', label: 'Sales tax payment', help: 'Payment to the state (reduces sales-tax owed).' },
    { value: 'payroll_wages', label: 'Payroll wages', help: 'Employee wages/salaries.' },
    { value: 'payroll_taxes', label: 'Payroll taxes', help: 'Payroll tax deposits/withholding payments.' },
    { value: 'loan_principal', label: 'Loan principal payment', help: 'Principal is not a deductible expense.' },
    { value: 'loan_interest', label: 'Loan interest', help: 'Interest may be deductible.' },
    { value: 'capex', label: 'Equipment / asset purchase', help: 'Capital purchase (usually depreciated).' },
    { value: 'owner_draw', label: 'Owner payment (draw)', help: 'Owner draw isn’t a business expense.' },
    { value: 'owner_estimated_tax', label: 'Owner tax payment (estimated)', help: 'Quarterly estimated tax payment.' },
    { value: 'transfer', label: 'Transfer', help: 'Move money between accounts (not income/expense).' },
    { value: 'uncategorized', label: 'Not sure yet', help: 'Use this if you’re unsure.' },
  ];

  const TAX_TREATMENT_OPTIONS: Array<{ value: string; label: string; help: string }> = [
    { value: 'deductible', label: 'Deductible', help: 'Counts as a write-off.' },
    { value: 'partial_50', label: '50% deductible', help: 'Common for meals in many cases.' },
    { value: 'non_deductible', label: 'Not deductible', help: 'Does not reduce taxable profit.' },
    { value: 'capitalized', label: 'Capital purchase', help: 'Tracked as an asset (not a normal expense).' },
    { value: 'review', label: 'Review', help: 'Treat conservatively until you confirm.' },
  ];

  function parseMoneyToNumber(raw: any): number | null {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim();
    if (!s) return null;
    const isParenNegative = /^\(.*\)$/.test(s);
    const cleaned = s.replace(/[^\d.\-]/g, '');
    if (!cleaned) return null;
    const val = Number.parseFloat(cleaned);
    if (!Number.isFinite(val)) return null;
    return isParenNegative ? -Math.abs(val) : val;
  }

  function getTxAmount(tx: Transaction): number | null {
    // Per requirement: display reads transactions.amount only.
    return parseMoneyToNumber((tx as any)?.amount);
  }

  function openTaxModal(tx: Transaction) {
    if (!TAX_FEATURES_ENABLED) {
      pushToast({ tone: 'info', message: 'Tax features are temporarily disabled.' });
      return;
    }
    setTaxTx(tx);
    setTaxCategory(String((tx as any)?.tax_category ?? 'uncategorized') || 'uncategorized');
    setTaxTreatment(String((tx as any)?.tax_treatment ?? 'review') || 'review');
    setTaxReason('');
    setTaxError(null);
    setTaxModalOpen(true);
  }

  function closeTaxModal() {
    setTaxModalOpen(false);
    setTaxTx(null);
    setTaxReason('');
    setTaxError(null);
  }

  async function handleAutoTagAgain() {
    if (!TAX_FEATURES_ENABLED) {
      setTaxReason('');
      setTaxError('Tax features are temporarily disabled.');
      return;
    }
    if (!taxTx) return;
    try {
      setTaxError(null);
      setTaxReason('Auto-tagging…');

      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? null;
      if (!token) throw new Error('Please log in again.');

      const res = await fetch('/api/transactions/classify-tax', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          transactions: [
            {
              description: taxTx.description,
              merchant: null,
              category: taxTx.category,
              amount: taxTx.amount,
            },
          ],
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || 'Auto-tagging failed.');
      }
      const json: any = await res.json();
      const tag = json?.results?.[0] ?? null;
      setTaxCategory(String(tag?.tax_category ?? 'uncategorized'));
      setTaxTreatment(String(tag?.tax_treatment ?? 'review'));
      setTaxReason(String(tag?.reasoning ?? ''));
    } catch (e: any) {
      setTaxReason('');
      setTaxError(e?.message ?? 'Auto-tagging failed.');
    }
  }

  async function handleSaveTaxTags() {
    if (!TAX_FEATURES_ENABLED) {
      setTaxError('Tax features are temporarily disabled.');
      return;
    }
    if (!taxTx || !selectedBusinessId) return;
    try {
      setTaxSaving(true);
      setTaxError(null);

      const { error } = await supabase
        .from('transactions')
        .update({
          tax_category: taxCategory,
          tax_treatment: taxTreatment,
          confidence_score: 1, // user-confirmed
          tax_reason: 'User confirmed',
        } as any)
        .eq('id', taxTx.id)
        .eq('business_id', selectedBusinessId);

      if (error) {
        // eslint-disable-next-line no-console
        console.error('TX_TAXTAG_UPDATE_ERROR', error);
        setTaxError(error.message ?? 'Could not save tax tags.');
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ['transactions', selectedBusinessId] });
      closeTaxModal();
    } catch (e: any) {
      setTaxError(e?.message ?? 'Could not save tax tags.');
    } finally {
      setTaxSaving(false);
    }
  }

  function isoToMdy(iso: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    const [yyyy, mm, dd] = iso.split('-');
    return `${mm}/${dd}/${yyyy}`;
  }

  // Optional deep-link hydration (used by Dashboard "Fix this first" links).
  // Supported params: q, from, to, category, flow, min, max
  useEffect(() => {
    try {
      const q = String(sp.get('q') ?? '');
      const from = String(sp.get('from') ?? '');
      const to = String(sp.get('to') ?? '');
      const cat = String(sp.get('category') ?? '');
      const flow = String(sp.get('flow') ?? '');
      const min = String(sp.get('min') ?? '');
      const max = String(sp.get('max') ?? '');

      if (q) setSearch(q);
      if (from) {
        setDateFromIso(from);
        setDateFromDisplay(isoToMdy(from));
      }
      if (to) {
        setDateToIso(to);
        setDateToDisplay(isoToMdy(to));
      }
      if (cat) setCategoryFilter(cat);
      if (min) setAmountMin(min);
      if (max) setAmountMax(max);
      if (flow === 'income') setFlowFilter('income');
      if (flow === 'expenses') setFlowFilter('expenses');

      // If any filters are present, reset paging for the filtered view.
      if (q || from || to || cat || flow || min || max) {
        setCurrentPage(1);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

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
    const amt = getTxAmount(tx) ?? 0;
    setFormMode('edit');
    setEditingTx(tx);
    setFormValues({
      date: tx.date ?? '',
      description: tx.description ?? '',
      category: tx.category ?? '',
      amount: String(Math.abs(amt)),
      customer_id: tx.customer_id ?? '',
      flow: amt < 0 ? 'expense' : 'income',
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
    const parsedAmount = parseMoneyToNumber(formValues.amount);
    if (parsedAmount === null) {
      setFormError('Amount is required and must be a number (e.g. 12.34).');
      return;
    }
    if (!selectedBusinessId) {
      setFormError('Loading your business…');
      return;
    }

    const absAmount = Math.abs(parsedAmount);
    const amountNumber = formValues.flow === 'expense' ? -absAmount : absAmount;
    const amountCents = Math.round(amountNumber * 100);
    const customerIdToSave = formValues.customer_id.trim() || null;

    try {
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user?.id ?? null;
      const token = sess.session?.access_token ?? null;
      if (!userId) {
        setFormError('Please log in to create transactions.');
        return;
      }
      if (!token) {
        setFormError('Please log in again.');
        return;
      }

      if (formMode === 'create') {
        // Insert a new transaction (schema-safe if amount_cents column doesn't exist yet).
        const basePayload: any = {
          date: formValues.date,
          description: formValues.description,
          category: formValues.category,
          amount: amountNumber,
          amount_cents: amountCents,
          customer_id: customerIdToSave,
          business_id: selectedBusinessId,
        };

        let inserted: any = null;
        let error: any = null;
        {
          const { data: d1, error: e1 } = await supabase
            .from('transactions')
            .insert(basePayload)
            .select('id, date, description, category, amount')
            .single();
          if (!e1) {
            inserted = d1;
            error = null;
          } else if (String((e1 as any)?.code ?? '') === '42703') {
            const { amount_cents: _omit, ...rest } = basePayload;
            const { data: d2, error: e2 } = await supabase
              .from('transactions')
              .insert(rest)
              .select('id, date, description, category, amount')
              .single();
            inserted = d2;
            error = e2 ?? null;
          } else {
            inserted = d1;
            error = e1 ?? null;
          }
        }

        if (error) {
          // eslint-disable-next-line no-console
          console.error('TX_CREATE_ERROR', error);
          setFormError(error.message ?? 'Could not create transaction.');
          return;
        }

        // Post-insert tagging (rules first, AI if needed) — disabled when tax features are off.
        if (TAX_FEATURES_ENABLED) {
          try {
            const classifyRes = await fetch('/api/transactions/classify-tax', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                transactions: [
                  {
                    description: inserted.description,
                    merchant: null,
                    category: inserted.category,
                    amount: inserted.amount,
                  },
                ],
              }),
            });
            const json: any = classifyRes.ok ? await classifyRes.json() : null;
            const tag = json?.results?.[0] ?? null;
            const tax_category = String(tag?.tax_category ?? 'uncategorized');
            const tax_treatment = String(tag?.tax_treatment ?? 'review');
            const confidence_score = Number(tag?.confidence_score ?? 0.5);
            const tax_reason = String(tag?.tax_reason ?? tag?.reasoning ?? '');

            await supabase
              .from('transactions')
              .update({ tax_category, tax_treatment, confidence_score, tax_reason } as any)
              .eq('id', inserted.id)
              .eq('business_id', selectedBusinessId);
          } catch {
            // ignore tagging errors; transaction still saves successfully
          }
        }

        await queryClient.invalidateQueries({ queryKey: ['transactions', selectedBusinessId] });
      } else if (formMode === 'edit' && editingTx) {
        const basePatch: any = {
          date: formValues.date,
          description: formValues.description,
          category: formValues.category,
          amount: amountNumber,
          amount_cents: amountCents,
          customer_id: customerIdToSave,
        };

        let updated: any = null;
        let error: any = null;
        {
          const { data: d1, error: e1 } = await supabase
            .from('transactions')
            .update(basePatch)
            .eq('id', editingTx.id)
            .eq('business_id', selectedBusinessId)
            .select('id, date, description, category, amount')
            .single();
          if (!e1) {
            updated = d1;
            error = null;
          } else if (String((e1 as any)?.code ?? '') === '42703') {
            const { amount_cents: _omit, ...rest } = basePatch;
            const { data: d2, error: e2 } = await supabase
              .from('transactions')
              .update(rest)
              .eq('id', editingTx.id)
              .eq('business_id', selectedBusinessId)
              .select('id, date, description, category, amount')
              .single();
            updated = d2;
            error = e2 ?? null;
          } else {
            updated = d1;
            error = e1 ?? null;
          }
        }

        if (error) {
          // eslint-disable-next-line no-console
          console.error('TX_UPDATE_ERROR', error);
          setFormError(error.message ?? 'Could not update transaction.');
          return;
        }

        // Post-update tagging (keep tax tags synced) — disabled when tax features are off.
        if (TAX_FEATURES_ENABLED) {
          try {
            const classifyRes = await fetch('/api/transactions/classify-tax', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                transactions: [
                  {
                    description: updated.description,
                    merchant: null,
                    category: updated.category,
                    amount: updated.amount,
                  },
                ],
              }),
            });
            const json: any = classifyRes.ok ? await classifyRes.json() : null;
            const tag = json?.results?.[0] ?? null;
            const tax_category = String(tag?.tax_category ?? 'uncategorized');
            const tax_treatment = String(tag?.tax_treatment ?? 'review');
            const confidence_score = Number(tag?.confidence_score ?? 0.5);
            const tax_reason = String(tag?.tax_reason ?? tag?.reasoning ?? '');

            await supabase
              .from('transactions')
              .update({ tax_category, tax_treatment, confidence_score, tax_reason } as any)
              .eq('id', updated.id)
              .eq('business_id', selectedBusinessId);
          } catch {
            // ignore tagging errors
          }
        }

        await queryClient.invalidateQueries({ queryKey: ['transactions', selectedBusinessId] });
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
        pushToast({ tone: 'info', message: 'Loading your business…' });
        return;
      }

      const userIdToUse = userId ?? null;
      if (!userIdToUse) {
        pushToast({ tone: 'error', message: 'Please log in to delete transactions.' });
        return;
      }

      const { error } = await supabase
        .from('transactions')
        .delete()
        .eq('id', tx.id)
        .eq('business_id', selectedBusinessId)
        ;

      if (error) {
        pushToast({ tone: 'error', message: 'Could not delete transaction. Please try again.' });
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: ['transactions', selectedBusinessId],
      });
      pushToast({ tone: 'ok', message: 'Transaction deleted.' });
    } catch {
      pushToast({ tone: 'error', message: 'Could not delete transaction. Please try again.' });
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

  function maskUsDate(input: string): string {
    const digits = input.replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  }

  function displayToIso(display: string): string | null {
    const v = display.trim();
    if (!v) return '';
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return null;
    const [mmS, ddS, yyyyS] = v.split('/');
    const mm = Number(mmS);
    const dd = Number(ddS);
    const yyyy = Number(yyyyS);
    if (!Number.isFinite(mm) || !Number.isFinite(dd) || !Number.isFinite(yyyy)) return null;
    if (mm < 1 || mm > 12) return null;
    if (dd < 1 || dd > 31) return null;
    if (yyyy < 1900 || yyyy > 2200) return null;
    const dt = new Date(yyyy, mm - 1, dd);
    if (
      dt.getFullYear() !== yyyy ||
      dt.getMonth() !== mm - 1 ||
      dt.getDate() !== dd
    ) {
      return null;
    }
    const iso = `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    return iso;
  }

  const hasActiveFilters =
    Boolean(search.trim()) ||
    Boolean(dateFromIso) ||
    Boolean(dateToIso) ||
    Boolean(dateFromDisplay.trim()) ||
    Boolean(dateToDisplay.trim()) ||
    Boolean(flowFilter !== 'all') ||
    Boolean(categoryFilter.trim()) ||
    Boolean(amountMin.trim()) ||
    Boolean(amountMax.trim());

  function clearFilters() {
    setSearch('');
    setDateFromIso('');
    setDateToIso('');
    setDateFromDisplay('');
    setDateToDisplay('');
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

    const amt = getTxAmount(tx);
    const matchesFlow =
      flowFilter === 'all' ||
      (flowFilter === 'income' && amt !== null && amt > 0) ||
      (flowFilter === 'expenses' && amt !== null && amt < 0);

    const matchesCategory =
      !categoryFilter.trim() ||
      String(tx.category ?? '').trim().toLowerCase() === categoryFilter.trim().toLowerCase();

    const matchesDateFrom = !dateFromIso || (tx.date ?? '') >= dateFromIso;
    const matchesDateTo = !dateToIso || (tx.date ?? '') <= dateToIso;

    const absAmt = amt === null ? NaN : Math.abs(amt);
    const min = Number(amountMin);
    const max = Number(amountMax);
    const matchesMin =
      !amountMin.trim() || (amt !== null && !Number.isNaN(min) && absAmt >= min);
    const matchesMax =
      !amountMax.trim() || (amt !== null && !Number.isNaN(max) && absAmt <= max);

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
      const aAmt = getTxAmount(a);
      const bAmt = getTxAmount(b);
      const aMissing = aAmt === null;
      const bMissing = bAmt === null;
      if (aMissing && bMissing) cmp = 0;
      else if (aMissing) cmp = 1; // push missing amounts to bottom
      else if (bMissing) cmp = -1;
      else cmp = aAmt - bAmt;
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

        {/* Filter bar (desktop) */}
        <section className="hidden md:block rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4 shadow-[0_1px_0_rgba(255,255,255,0.04)]">
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

            <div className="flex flex-wrap gap-3 items-center">
              {/* Search */}
              <div className="relative flex-1 min-w-[240px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Search description or category…"
                  className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-9 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
              </div>

              {/* Date range */}
              <div className="flex items-center gap-2">
                <div className="relative w-[140px]">
                  <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="MM/DD/YYYY"
                    value={dateFromDisplay}
                    onChange={(e) => {
                      const next = maskUsDate(e.target.value);
                      setDateFromDisplay(next);
                      const iso = displayToIso(next);
                      setDateFromIso(iso === null ? '' : iso);
                      setCurrentPage(1);
                    }}
                    className="h-10 w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 tabular-nums"
                    aria-label="From date"
                  />
                </div>
                <div className="w-[140px]">
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="MM/DD/YYYY"
                    value={dateToDisplay}
                    onChange={(e) => {
                      const next = maskUsDate(e.target.value);
                      setDateToDisplay(next);
                      const iso = displayToIso(next);
                      setDateToIso(iso === null ? '' : iso);
                      setCurrentPage(1);
                    }}
                    className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 tabular-nums"
                    aria-label="To date"
                  />
                </div>
              </div>

              {/* Income/Expense */}
              <div className="w-[180px]">
                <div className="h-10 grid grid-cols-3 rounded-xl border border-white/10 bg-white/5 p-1 text-[11px]">
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
                        className={`rounded-lg font-semibold transition ${
                          active ? 'bg-white/10 text-slate-50' : 'text-slate-300 hover:bg-white/5'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Category */}
              <div className="w-[220px]">
                <select
                  style={{ colorScheme: 'dark' }}
                  value={categoryFilter}
                  onChange={(e) => {
                    setCategoryFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 hover:bg-slate-950/80 hover:border-white/20"
                >
                  <option value="" className="bg-slate-950 text-slate-100">
                    All categories
                  </option>
                  {categoryOptions.map((c) => (
                    <option key={c} value={c} className="bg-slate-950 text-slate-100">
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Amount range */}
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="Min Price"
                  value={amountMin}
                  onChange={(e) => {
                    setAmountMin(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="h-10 w-[96px] rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="Max Price"
                  value={amountMax}
                  onChange={(e) => {
                    setAmountMax(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="h-10 w-[96px] rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
                <span className="text-[11px] text-slate-400">Filter by amount.</span>
              </div>
            </div>
          </div>
        </section>

        {/* Mobile filters trigger (filters/search live in a bottom sheet) */}
        <section className="md:hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4 shadow-[0_1px_0_rgba(255,255,255,0.04)]">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Filters</div>
              <div className="mt-1 text-sm text-slate-200 truncate">
                {hasActiveFilters ? 'Filters active' : 'No filters'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
              >
                <SlidersHorizontal className="h-4 w-4" />
                Filter
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
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
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
                    const amt = getTxAmount(tx);
                    const missingAmt = amt === null;
                    const isNegative = !missingAmt && amt < 0;
                    const amountClass = missingAmt ? 'text-slate-500' : isNegative ? 'text-rose-300' : 'text-emerald-300';
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
                              {missingAmt ? '—' : (
                                <>
                                  {isNegative ? '-' : '+'}
                                  {formatCurrency(Math.abs(amt))}
                                </>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 align-top text-right">
                            {TAX_FEATURES_ENABLED ? (
                              <button
                                type="button"
                                onClick={() => openTaxModal(tx)}
                                className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 p-2 text-slate-200 opacity-0 group-hover:opacity-100 hover:bg-white/10 transition"
                                aria-label="Fix tax tag"
                                title="Fix tax tag"
                              >
                                <Tag className="h-4 w-4" />
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => openEditForm(tx)}
                              className="ml-2 inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 p-2 text-slate-200 opacity-0 group-hover:opacity-100 hover:bg-white/10 transition"
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

              {/* Mobile card list */}
              <div className="md:hidden space-y-3">
                {paginatedTransactions.map((tx) => {
                  const amt = getTxAmount(tx);
                  const missingAmt = amt === null;
                  const isNegative = !missingAmt && amt < 0;
                  const amountClass = missingAmt
                    ? 'text-slate-400'
                    : isNegative
                      ? 'text-rose-300'
                      : 'text-emerald-300';
                  const cat = String(tx.category ?? '').trim() || 'Uncategorized';
                  const dateObj = new Date(tx.date);
                  const dateLabel = Number.isNaN(dateObj.getTime())
                    ? String(tx.date ?? '—')
                    : dateObj.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      });

                  return (
                    <div
                      key={tx.id}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-100 truncate">
                            {tx.description || '—'}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                            <span className="tabular-nums">{dateLabel}</span>
                            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-200">
                              {cat}
                            </span>
                            <span>{isNegative ? 'Expense' : 'Income'}</span>
                          </div>
                        </div>
                        <div className={`text-sm font-semibold tabular-nums ${amountClass}`}>
                          {missingAmt ? (
                            '—'
                          ) : (
                            <>
                              {isNegative ? '-' : '+'}
                              {formatCurrency(Math.abs(amt))}
                            </>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-end gap-2">
                        {TAX_FEATURES_ENABLED ? (
                          <button
                            type="button"
                            onClick={() => openTaxModal(tx)}
                            className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
                            aria-label="Fix tax tag"
                            title="Fix tax tag"
                          >
                            <Tag className="h-4 w-4" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => openEditForm(tx)}
                          className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
                          aria-label="Edit transaction"
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(tx)}
                          className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-rose-200 hover:bg-white/10"
                          aria-label="Delete transaction"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Simple client-side pagination controls */}
              <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-[11px] text-slate-300">
                <div>
                  Rows per page:
                  <select
                    style={{ colorScheme: 'dark' }}
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="ml-2 rounded-lg bg-slate-950/60 px-2 py-1 border border-white/10 text-slate-100 hover:bg-slate-950/80 hover:border-white/20"
                  >
                    <option value={10} className="bg-slate-950 text-slate-100">10</option>
                    <option value={25} className="bg-slate-950 text-slate-100">25</option>
                    <option value={50} className="bg-slate-950 text-slate-100">50</option>
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
                    style={{ colorScheme: 'dark' }}
                    value={formValues.category}
                    onChange={(e) => handleFormChange('category', e.target.value)}
                    className="w-full bg-slate-950/70 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-slate-100 hover:bg-slate-950/80 hover:border-white/20"
                  >
                    <option value="" className="bg-slate-950 text-slate-100">Uncategorized</option>
                    {/* Preserve any legacy category values without overwriting on edit */}
                    {formValues.category &&
                      formValues.category.trim() &&
                      !(CATEGORIES as readonly string[]).includes(
                        formValues.category.trim()
                      ) && (
                        <option value={formValues.category} className="bg-slate-950 text-slate-100">
                          {formValues.category} (Legacy)
                        </option>
                      )}
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c} className="bg-slate-950 text-slate-100">
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
                    style={{ colorScheme: 'dark' }}
                    value={formValues.customer_id}
                    onChange={(e) =>
                      handleFormChange('customer_id', e.target.value)
                    }
                    className="w-full bg-slate-950/70 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-slate-100 hover:bg-slate-950/80 hover:border-white/20"
                    disabled={!selectedBusinessId || customersLoading}
                  >
                    <option value="">
                      {customersLoading
                        ? 'Loading customers…'
                        : 'None (Unknown Customer)'
                      }
                    </option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id} className="bg-slate-950 text-slate-100">
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

        {/* Mobile filter sheet */}
        <BottomSheet
          open={mobileFiltersOpen}
          onClose={() => setMobileFiltersOpen(false)}
          title="Filters"
        >
          <div className="space-y-4">
            {/* Search */}
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Search</div>
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
                  className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-9 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
              </div>
            </div>

            {/* Date range */}
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Date range</div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="From (MM/DD/YYYY)"
                    value={dateFromDisplay}
                    onChange={(e) => {
                      const next = maskUsDate(e.target.value);
                      setDateFromDisplay(next);
                      const iso = displayToIso(next);
                      setDateFromIso(iso === null ? '' : iso);
                      setCurrentPage(1);
                    }}
                    className="h-11 w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 tabular-nums"
                  />
                </div>
                <div className="flex-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="To (MM/DD/YYYY)"
                    value={dateToDisplay}
                    onChange={(e) => {
                      const next = maskUsDate(e.target.value);
                      setDateToDisplay(next);
                      const iso = displayToIso(next);
                      setDateToIso(iso === null ? '' : iso);
                      setCurrentPage(1);
                    }}
                    className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 tabular-nums"
                  />
                </div>
              </div>
            </div>

            {/* Income/Expense */}
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Type</div>
              <div className="h-11 grid grid-cols-3 rounded-xl border border-white/10 bg-white/5 p-1 text-[11px]">
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
                      className={`rounded-lg font-semibold transition ${
                        active ? 'bg-white/10 text-slate-50' : 'text-slate-300 hover:bg-white/5'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Category */}
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Category</div>
              <select
                style={{ colorScheme: 'dark' }}
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="h-11 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 hover:bg-slate-950/80 hover:border-white/20"
              >
                <option value="" className="bg-slate-950 text-slate-100">
                  All categories
                </option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c} className="bg-slate-950 text-slate-100">
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Amount range */}
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Amount</div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="Min"
                  value={amountMin}
                  onChange={(e) => {
                    setAmountMin(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="h-11 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
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
                  className="h-11 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
              </div>
            </div>

            <div className="pt-1">
              <button
                type="button"
                onClick={clearFilters}
                disabled={!hasActiveFilters}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FilterX className="h-4 w-4" />
                Clear filters
              </button>
            </div>
          </div>
        </BottomSheet>

        {/* Mobile primary action */}
        <MobileFab onClick={openCreateForm} label="New transaction" />

        {/* Tax tagging modal (plain-English) */}
        {TAX_FEATURES_ENABLED && taxModalOpen && taxTx && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-slate-950/90 p-6 shadow-2xl backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                    Smart Taxes
                  </div>
                  <div className="mt-2 text-lg font-semibold text-slate-50 tracking-tight">
                    Fix tax tag
                  </div>
                  <div className="mt-1 text-sm text-slate-300 leading-relaxed">
                    Choose what this is, in plain English. This improves your estimates.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeTaxModal}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-sm font-semibold text-slate-100 truncate">
                  {taxTx.description || '—'}
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  {taxTx.date} • {formatCurrency(getTxAmount(taxTx) ?? 0)}
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                    What is it?
                  </div>
                  <select
                    style={{ colorScheme: 'dark' }}
                    value={taxCategory}
                    onChange={(e) => setTaxCategory(e.target.value)}
                    className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 hover:bg-slate-950/80 hover:border-white/20"
                  >
                    {TAX_CATEGORY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value} className="bg-slate-950 text-slate-100">
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {TAX_CATEGORY_OPTIONS.find((o) => o.value === taxCategory)?.help ?? ''}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                    How should it count?
                  </div>
                  <select
                    style={{ colorScheme: 'dark' }}
                    value={taxTreatment}
                    onChange={(e) => setTaxTreatment(e.target.value)}
                    className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 hover:bg-slate-950/80 hover:border-white/20"
                  >
                    {TAX_TREATMENT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value} className="bg-slate-950 text-slate-100">
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {TAX_TREATMENT_OPTIONS.find((o) => o.value === taxTreatment)?.help ?? ''}
                  </div>
                </div>
              </div>

              {taxReason && (
                <div className="mt-3 text-[11px] text-slate-400">
                  {taxReason}
                </div>
              )}

              {taxError && (
                <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {taxError}
                </div>
              )}

              <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <button
                  type="button"
                  onClick={() => void handleAutoTagAgain()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
                >
                  <RotateCw className="h-4 w-4" />
                  Auto-tag again
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={closeTaxModal}
                    className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveTaxTags()}
                    disabled={taxSaving || !selectedBusinessId}
                    className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {taxSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
    </main>
  );
}
