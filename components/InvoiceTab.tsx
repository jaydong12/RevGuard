'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  Pencil,
  Printer,
  Save,
  Plus,
  X,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { supabase } from '../utils/supabaseClient';
import { getOrCreateBusinessId } from '../lib/getOrCreateBusinessId';
import { generateInvoiceNumber } from '../lib/invoiceNumber';
import { deleteInvoiceLinkedTransactions, upsertRevenueTransactionForInvoice } from '../lib/invoiceTransactionSync';

type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue';

type InvoiceRow = {
  id: any;
  business_id: string;
  invoice_number: string;
  client_name: string;
  issue_date: string | null;
  due_date: string | null;
  status: InvoiceStatus;
  subtotal: number;
  tax: number | null;
  total: number;
  notes: string | null;
  paid_at?: string | null;
  created_at: string;
};

type InvoiceItemRow = {
  id?: any;
  invoice_id: any;
  description: string | null;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
};

function formatIsoToLocalPretty(iso: string): string {
  const d = new Date(String(iso ?? ''));
  if (Number.isNaN(d.getTime())) return String(iso ?? '');
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

function formatNotesForDisplay(notes: any): string {
  const s = String(notes ?? '').trim();
  if (!s) return '';
  // Replace common ISO 8601 timestamps with local pretty formatting.
  return s.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, (m) => formatIsoToLocalPretty(m));
}

type BusinessInfo = {
  id: string;
  owner_id?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  logo_url?: string | null;
  address1?: string | null;
  address2?: string | null;
  // legacy fallbacks
  address?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

type Props = {
  // Kept for compatibility with `app/invoices/page.tsx` but not relied on.
  businessId?: string | null;
  businessName?: string;
  invoices?: any[];
  userId?: string | null;
  loading?: boolean;
  error?: string | null;
};

function tryConsoleLog(...args: any[]) {
  try {
    (globalThis as any)?.console?.log?.(...args);
  } catch {
    // ignore
  }
}

function storeDebug(...args: any[]) {
  try {
    const g: any = globalThis as any;
    const buf: any[] = Array.isArray(g.__revguardDebugLogs) ? g.__revguardDebugLogs : [];
    buf.push({ at: Date.now(), args });
    g.__revguardDebugLogs = buf.slice(-50);
  } catch {
    // ignore
  }
}

function formatMoney(n: any) {
  const num = Number(n);
  const safe = Number.isFinite(num) ? num : 0;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(safe);
  } catch {
    return `$${safe.toFixed(2)}`;
  }
}

function badgeForStatus(status: InvoiceStatus) {
  switch (status) {
    case 'paid':
      return 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/30';
    case 'sent':
      return 'bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/30';
    case 'overdue':
      return 'bg-rose-500/15 text-rose-200 ring-1 ring-rose-500/30';
    default:
      return 'bg-slate-500/15 text-slate-200 ring-1 ring-slate-500/30';
  }
}

function safeDate(d: string | null) {
  if (!d) return '';
  // Keep YYYY-MM-DD if present
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function money(n: any) {
  const num = Number(n);
  return Number.isFinite(num) ? num : 0;
}

function isMissingColumnError(e: any) {
  return String((e as any)?.code ?? '') === '42703' || /column .* does not exist/i.test(String((e as any)?.message ?? ''));
}

function formatAddr(b: BusinessInfo | null) {
  const lines: string[] = [];
  const legacy =
    b?.address && String(b.address).trim()
      ? String(b.address)
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const a1 = b?.address1 ?? b?.address_line1 ?? legacy[0] ?? null;
  const a2 = b?.address2 ?? b?.address_line2 ?? legacy.slice(1).join(' ') ?? null;

  if (a1) lines.push(String(a1));
  if (a2) lines.push(String(a2));
  const cityLine = [b?.city, b?.state, b?.zip].filter(Boolean).join(', ');
  if (cityLine) lines.push(cityLine);
  return lines;
}

export default function InvoiceTab(_props: Props) {
  const queryClient = useQueryClient();
  const [booting, setBooting] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSupabaseError, setLastSupabaseError] = useState<any | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businessInfo, setBusinessInfo] = useState<BusinessInfo | null>(null);

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState<20 | 50>(20);
  const [pageHasMore, setPageHasMore] = useState(false);

  const [search, setSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceStatus>('all');
  const [createdFrom, setCreatedFrom] = useState(''); // YYYY-MM-DD
  const [createdTo, setCreatedTo] = useState(''); // YYYY-MM-DD

  // List expand/collapse + row expansion
  const [listExpanded, setListExpanded] = useState(false); // compact by default
  const [expandedRowId, setExpandedRowId] = useState<any | null>(null);

  // Printing
  const [printInvoice, setPrintInvoice] = useState<InvoiceRow | null>(null);
  const [printItems, setPrintItems] = useState<InvoiceItemRow[] | null>(null);
  const [printing, setPrinting] = useState(false);

  // Edit mode
  const [editingId, setEditingId] = useState<any | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);

  // Form state
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [clientName, setClientName] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [status, setStatus] = useState<InvoiceStatus>('draft');
  const [subtotal, setSubtotal] = useState('0');
  const [tax, setTax] = useState('0');
  const [notes, setNotes] = useState('');

  const total = useMemo(() => {
    const s = Number(subtotal);
    const t = Number(tax);
    const safeS = Number.isFinite(s) ? s : 0;
    const safeT = Number.isFinite(t) ? t : 0;
    return safeS + safeT;
  }, [subtotal, tax]);

  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Reset pagination when filters change
  useEffect(() => {
    setPageIndex(0);
  }, [businessId, pageSize, searchQuery, statusFilter, createdFrom, createdTo]);

  // Close any expanded row when paging/filtering
  useEffect(() => {
    setExpandedRowId(null);
  }, [pageIndex, pageSize, searchQuery, statusFilter, createdFrom, createdTo]);

  function toggleRow(invId: any) {
    setExpandedRowId((prev: any) => (String(prev) === String(invId) ? null : invId));
  }

  async function loadInvoicesPage(params: {
    bizId: string;
    pageIndex: number;
    pageSize: number;
    searchQuery: string;
    statusFilter: 'all' | InvoiceStatus;
    createdFrom: string;
    createdTo: string;
  }) {
    setLoadingList(true);
    try {
      let q: any = supabase
        .from('invoices')
        .select('*', { count: 'exact' })
        .eq('business_id', params.bizId)
        .order('created_at', { ascending: false });

      if (params.statusFilter !== 'all') {
        q = q.eq('status', params.statusFilter);
      }

      const raw = params.searchQuery.trim();
      if (raw) {
        // Supabase `.or()` filter is comma-separated; avoid commas in user input.
        const cleaned = raw.replaceAll(',', ' ').slice(0, 64);
        const pattern = `%${cleaned}%`;
        q = q.or(`invoice_number.ilike.${pattern},client_name.ilike.${pattern}`);
      }

      if (params.createdFrom) {
        q = q.gte('created_at', `${params.createdFrom}T00:00:00.000Z`);
      }
      if (params.createdTo) {
        q = q.lte('created_at', `${params.createdTo}T23:59:59.999Z`);
      }

      const from = params.pageIndex * params.pageSize;
      const to = from + params.pageSize - 1;

      const { data, error: invErr, count } = await q.range(from, to);

      if (invErr) {
        setError(invErr.message || 'Failed to load invoices.');
        return;
      }

      setInvoices(((data ?? []) as any[]) as InvoiceRow[]);
      setTotalCount(typeof count === 'number' ? count : null);
      if (typeof count === 'number') {
        const totalPages = Math.max(1, Math.ceil(count / params.pageSize));
        setPageHasMore(params.pageIndex < totalPages - 1);
      } else {
        setPageHasMore(((data ?? []) as any[]).length === params.pageSize);
      }
    } finally {
      setLoadingList(false);
    }
  }

  async function fetchBusinessInfo(bizId: string) {
    const { data, error: bErr } = await supabase
      .from('business')
      .select('*')
      .eq('id', bizId)
      .maybeSingle();

    if (bErr) {
      // Non-fatal; still allow invoice operations.
      tryConsoleLog('Business info load failed', bErr);
      storeDebug('Business info load failed', bErr);
      return;
    }

    setBusinessInfo(((data ?? null) as any) ?? null);
  }

  function resetForm() {
    setEditingId(null);
    setInvoiceNumber('');
    setClientName('');
    setIssueDate('');
    setDueDate('');
    setStatus('draft');
    setSubtotal('0');
    setTax('0');
    setNotes('');
  }

  function beginEdit(inv: InvoiceRow) {
    // eslint-disable-next-line no-console
    console.log('INVOICE_EDIT_BEGIN', { id: inv?.id, invoice_number: inv?.invoice_number });
    setEditingId(inv.id);
    setInvoiceNumber(inv.invoice_number ?? '');
    setClientName(inv.client_name ?? '');
    setIssueDate(safeDate(inv.issue_date));
    setDueDate(safeDate(inv.due_date));
    setStatus((inv.status as InvoiceStatus) ?? 'draft');
    setSubtotal(String(inv.subtotal ?? 0));
    setTax(String(inv.tax ?? 0));
    setNotes(inv.notes ?? '');

    // Make the edit action obvious (especially if the user is scrolled down the list).
    requestAnimationFrame(() => {
      try {
        formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch {
        // ignore
      }
    });
  }

  async function beginPrint(inv: InvoiceRow) {
    setError(null);
    setLastSupabaseError(null);

    setPrinting(true);
    setPrintInvoice(inv);
    setPrintItems(null);

    // Attempt to load line items if the table exists; otherwise fall back gracefully.
    try {
      const { data, error: itemsErr } = await supabase
        .from('invoice_items')
        .select('*')
        .eq('invoice_id', inv.id)
        .order('id', { ascending: true });
      if (itemsErr) {
        tryConsoleLog('PRINT_ITEMS_ERROR', itemsErr);
        storeDebug('PRINT_ITEMS_ERROR', itemsErr);
      } else {
        setPrintItems(((data ?? []) as any[]) as InvoiceItemRow[]);
      }
    } catch (e: any) {
      tryConsoleLog('PRINT_ITEMS_THROW', e);
      storeDebug('PRINT_ITEMS_THROW', e);
    }

    // Wait for React to render the print DOM, then print.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          window.print();
        } catch {
          // ignore
        }
      });
    });
  }

  useEffect(() => {
    function onAfterPrint() {
      setPrinting(false);
      setPrintInvoice(null);
      setPrintItems(null);
    }
    window.addEventListener('afterprint', onAfterPrint);
    return () => window.removeEventListener('afterprint', onAfterPrint);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      setBooting(true);
      setError(null);
      setLastSupabaseError(null);

      const { data, error: userErr } = await supabase.auth.getUser();
      const user = data?.user ?? null;

      if (cancelled) return;

      if (userErr) {
        setError(userErr.message || 'Failed to get session user.');
        setBooting(false);
        return;
      }

      if (!user) {
        setUserId(null);
        setBusinessId(null);
        setBooting(false);
        return;
      }

      setUserId(user.id);

      let bizId: string;
      try {
        bizId = await getOrCreateBusinessId(supabase);
      } catch (e: any) {
        setError(e?.message || 'Failed to load business.');
        setBooting(false);
        return;
      }

      if (cancelled) return;

      setBusinessId(bizId);
      await Promise.all([
        loadInvoicesPage({
          bizId,
          pageIndex: 0,
          pageSize,
          searchQuery: '',
          statusFilter: 'all',
          createdFrom: '',
          createdTo: '',
        }),
        fetchBusinessInfo(bizId),
      ]);
      setBooting(false);
    }

    void boot();

    return () => {
      cancelled = true;
    };
  }, []);

  const saveDisabled = !businessId || saving || booting;

  async function refreshList(opts?: { resetPage?: boolean }) {
    if (!businessId) return;
    const nextPage = opts?.resetPage ? 0 : pageIndex;
    if (opts?.resetPage) setPageIndex(0);
    await loadInvoicesPage({
      bizId: businessId,
      pageIndex: nextPage,
      pageSize,
      searchQuery,
      statusFilter,
      createdFrom,
      createdTo,
    });
  }

  useEffect(() => {
    if (!businessId) return;
    void loadInvoicesPage({
      bizId: businessId,
      pageIndex,
      pageSize,
      searchQuery,
      statusFilter,
      createdFrom,
      createdTo,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, pageIndex, pageSize, searchQuery, statusFilter, createdFrom, createdTo]);

  async function handleSave() {
    setError(null);
    setLastSupabaseError(null);

    if (!clientName.trim()) {
      setError('Client name is required.');
      return;
    }

    // Always resolve business_id fresh for save paths
    let businessIdToUse: string;
    try {
      businessIdToUse = await getOrCreateBusinessId(supabase);
    } catch (e: any) {
      setError(e?.message || 'Not signed in');
      return;
    }

    setBusinessId(businessIdToUse);

    // User request: when an invoice is "sent", immediately treat it as paid and create revenue transaction.
    const normalizedStatus: InvoiceStatus = status === 'sent' ? 'paid' : status;

    let invNum = (invoiceNumber || '').trim();
    if (!invNum) {
      try {
        invNum = await generateInvoiceNumber({ supabase, businessId: businessIdToUse });
      } catch {
        invNum = `INV-${Date.now()}`;
      }
    }
    const s = Number(subtotal);
    const t = Number(tax);
    const safeSubtotal = Number.isFinite(s) ? s : 0;
    const safeTax = Number.isFinite(t) ? t : 0;

    const payload = {
      business_id: businessIdToUse,
      invoice_number: invNum,
      client_name: clientName.trim(),
      issue_date: issueDate ? issueDate : null,
      due_date: dueDate ? dueDate : null,
      status: normalizedStatus,
      subtotal: safeSubtotal,
      tax: safeTax,
      total: safeSubtotal + safeTax,
      notes: notes.trim() ? notes.trim() : null,
    };

    tryConsoleLog('Invoice save payload', payload);
    storeDebug('Invoice save payload', payload);

    setSaving(true);
    try {
      let savedInvoice: any | null = null;
      if (editingId) {
        const { data: updated, error: updErr } = await supabase
          .from('invoices')
          .update(payload)
          .eq('id', editingId)
          .eq('business_id', businessIdToUse)
          .select('*')
          .single();

        if (updErr || !updated) {
          tryConsoleLog('Invoice update failed error', updErr);
          storeDebug('Invoice update failed error', updErr);
          setLastSupabaseError(updErr ?? { message: 'Unknown update failure' });

          const code = (updErr as any)?.code ?? null;
          const msg = (updErr as any)?.message ?? 'Could not update invoice.';
          const details = (updErr as any)?.details ?? null;
          setError(
            `Invoice update failed.\n` +
              `code: ${code ?? 'n/a'}\n` +
              `message: ${msg}\n` +
              `details: ${details ?? 'n/a'}`
          );
          return;
        }
        savedInvoice = updated as any;
      } else {
        const { data: inserted, error: insErr } = await supabase
          .from('invoices')
          .insert(payload)
          .select('*')
          .single();

        if (insErr || !inserted) {
          tryConsoleLog('Invoice insert failed error', insErr);
          storeDebug('Invoice insert failed error', insErr);
          setLastSupabaseError(insErr ?? { message: 'Unknown insert failure' });

          const code = (insErr as any)?.code ?? null;
          const msg = (insErr as any)?.message ?? 'Could not save invoice.';
          const details = (insErr as any)?.details ?? null;
          setError(
            `Invoice save failed.\n` +
              `code: ${code ?? 'n/a'}\n` +
              `message: ${msg}\n` +
              `details: ${details ?? 'n/a'}`
          );
          return;
        }
        savedInvoice = inserted as any;
      }

      // Keep invoice status + revenue transaction in sync.
      // - paid => ensure one linked transaction exists/updated
      // - non-paid => delete any linked transaction
      try {
        const invoiceId = Number(savedInvoice?.id ?? 0) || 0;
        if (normalizedStatus === 'paid') {
          await upsertRevenueTransactionForInvoice({
            supabase,
            businessId: businessIdToUse,
            invoice: savedInvoice,
          });
        } else if (invoiceId) {
          await deleteInvoiceLinkedTransactions({ supabase, businessId: businessIdToUse, invoiceId });
        }
        // Refresh Transactions tab (AppDataProvider cache) so invoice-linked income shows up immediately.
        await queryClient.invalidateQueries({ queryKey: ['transactions', businessIdToUse] });
      } catch (e: any) {
        // Non-fatal: invoice save succeeded; sync may fail if DB hasn't been migrated yet.
        tryConsoleLog('INVOICE_TX_SYNC_ERROR', e);
        storeDebug('INVOICE_TX_SYNC_ERROR', e);
      }

      // Reload current list (reset to first page so new invoice is visible at top)
      await refreshList({ resetPage: true });
      resetForm();
    } finally {
      setSaving(false);
    }
  }

  if (!booting && !userId) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5 text-sm text-slate-200">
        Please sign in.
      </div>
    );
  }

  const bizTitle = businessInfo?.name || 'My Business';
  const bizMeta = [businessInfo?.email, businessInfo?.phone, businessInfo?.website]
    .filter(Boolean)
    .join(' • ');
  const addrLines = formatAddr(businessInfo);

  const itemsToPrint = (printItems ?? []).filter((it) => (it.description ?? '').trim());
  const showItems = itemsToPrint.length > 0;
  const printSubtotal = printInvoice ? money(printInvoice.subtotal) : 0;
  const printTax = printInvoice ? money(printInvoice.tax ?? 0) : 0;
  const printTotal = printInvoice ? money(printInvoice.total) : 0;

  return (
    <div className="space-y-4">
      {/* Print-only sheet (never routes away; browser prints current DOM) */}
      <style>{`
@media print {
  body * { visibility: hidden !important; }
  #rg-print-root, #rg-print-root * { visibility: visible !important; }
  #rg-print-root { position: absolute; left: 0; top: 0; width: 100%; }
}
      `}</style>

      <div id="rg-print-root" className={printing && printInvoice ? 'block' : 'hidden'}>
        {printInvoice ? (
          <div className="mx-auto w-full max-w-[800px] bg-white px-10 py-10 text-slate-900">
            <div className="flex items-start justify-between gap-10">
              <div className="min-w-0">
                {businessInfo?.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={businessInfo.logo_url}
                    alt={bizTitle}
                    className="mb-4 h-12 max-w-[240px] object-contain"
                  />
                ) : null}
                <div className="text-2xl font-extrabold tracking-tight">{bizTitle}</div>
                {bizMeta ? <div className="mt-1 text-sm text-slate-600">{bizMeta}</div> : null}
                {addrLines.length ? (
                  <div className="mt-1 text-sm text-slate-600">
                    {addrLines.map((l) => (
                      <div key={l}>{l}</div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="text-right">
                <div className="text-3xl font-extrabold tracking-tight">Invoice</div>
                <div className="mt-2 text-sm text-slate-700">
                  <div>
                    <span className="font-semibold">#</span> {printInvoice.invoice_number}
                  </div>
                  <div>
                    <span className="font-semibold">Issue:</span> {printInvoice.issue_date || '—'}
                  </div>
                  <div>
                    <span className="font-semibold">Due:</span> {printInvoice.due_date || '—'}
                  </div>
                  <div className="capitalize">
                    <span className="font-semibold">Status:</span> {printInvoice.status}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 rounded-xl border border-slate-200 p-5">
              <div className="text-sm font-semibold text-slate-700">Bill To</div>
              <div className="mt-1 text-base font-bold">{printInvoice.client_name}</div>

              <div className="mt-6">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="py-2 text-left text-xs font-semibold text-slate-500">
                        Item
                      </th>
                      <th className="py-2 text-right text-xs font-semibold text-slate-500">
                        Qty
                      </th>
                      <th className="py-2 text-right text-xs font-semibold text-slate-500">
                        Unit
                      </th>
                      <th className="py-2 text-right text-xs font-semibold text-slate-500">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {showItems ? (
                      itemsToPrint.map((it, idx) => {
                        const qty = money(it.quantity ?? 0);
                        const unit = money(it.unit_price ?? 0);
                        const amt = money(it.line_total ?? qty * unit);
                        return (
                          <tr key={String(it.id ?? idx)} className="border-b border-slate-100">
                            <td className="py-3 text-sm">{it.description}</td>
                            <td className="py-3 text-right text-sm">{qty}</td>
                            <td className="py-3 text-right text-sm">{formatMoney(unit)}</td>
                            <td className="py-3 text-right text-sm font-semibold">
                              {formatMoney(amt)}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr className="border-b border-slate-100">
                        <td className="py-3 text-sm">Services</td>
                        <td className="py-3 text-right text-sm">1</td>
                        <td className="py-3 text-right text-sm">{formatMoney(printSubtotal)}</td>
                        <td className="py-3 text-right text-sm font-semibold">
                          {formatMoney(printSubtotal)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 flex justify-end">
                <div className="w-full max-w-[320px] space-y-2 text-sm">
                  <div className="flex items-center justify-between text-slate-700">
                    <span>Subtotal</span>
                    <span className="font-semibold">{formatMoney(printSubtotal)}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-700">
                    <span>Tax</span>
                    <span className="font-semibold">{formatMoney(printTax)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-base">
                    <span className="font-extrabold">Total</span>
                    <span className="font-extrabold">{formatMoney(printTotal)}</span>
                  </div>
                </div>
              </div>

              {printInvoice.notes ? (
                <div className="mt-6">
                  <div className="text-sm font-semibold text-slate-700">Notes</div>
                  <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                    {printInvoice.notes}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {booting ? <div className="text-xs text-slate-400">Loading…</div> : null}

      {error ? (
        <div className="rounded-2xl border border-rose-900/50 bg-rose-950/40 p-4 text-sm text-rose-200">
          <pre className="whitespace-pre-wrap break-words">{error}</pre>
          {lastSupabaseError ? (
            <div className="mt-3 rounded-xl border border-rose-900/40 bg-black/20 p-3 text-[11px] text-rose-100/90">
              <div className="font-semibold">Supabase error (raw)</div>
              <pre className="mt-1 whitespace-pre-wrap break-words">
                {JSON.stringify(
                  {
                    code: (lastSupabaseError as any)?.code ?? null,
                    message: (lastSupabaseError as any)?.message ?? null,
                    details: (lastSupabaseError as any)?.details ?? null,
                    hint: (lastSupabaseError as any)?.hint ?? null,
                  },
                  null,
                  2
                )}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Header */}
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-950/60 to-slate-900/40 p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            {businessInfo?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={businessInfo.logo_url}
                alt={bizTitle}
                className="h-11 w-11 rounded-2xl object-contain bg-white/5 ring-1 ring-slate-700"
              />
            ) : (
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-500/25">
                <FileText className="h-5 w-5" />
              </div>
            )}
            <div>
              <div className="text-lg font-semibold text-slate-50">Invoices</div>
              <div className="text-xs text-slate-400">
                From <span className="text-slate-200">{bizTitle}</span>
                {bizMeta ? <span className="text-slate-500"> • {bizMeta}</span> : null}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshList()}
              disabled={!businessId || loadingList}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900/70 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loadingList ? 'animate-spin' : ''}`} />
              Refresh
            </button>

            <button
              type="button"
              onClick={resetForm}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              <Plus className="h-4 w-4" />
              New invoice
            </button>
          </div>
        </div>
      </div>

      {/* Form */}
      <div ref={formRef} className="rounded-2xl border border-slate-800 bg-[#0B1220] p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-100">
            {editingId ? 'Edit invoice' : 'Create invoice'}
          </div>
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900/70"
            >
              <X className="h-4 w-4" />
              Cancel
            </button>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <div className="text-xs text-slate-400">Invoice #</div>
            <input
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-600"
              placeholder="INV-1001 (optional)"
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs text-slate-400">Client name *</div>
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-600"
              placeholder="Acme Co."
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs text-slate-400">Issue date</div>
            <input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-600"
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs text-slate-400">Due date</div>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-600"
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs text-slate-400">Status</div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as InvoiceStatus)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-600"
            >
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
            </select>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-slate-400">Subtotal</div>
            <input
              inputMode="decimal"
              value={subtotal}
              onChange={(e) => setSubtotal(e.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-600"
              placeholder="0.00"
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs text-slate-400">Tax</div>
            <input
              inputMode="decimal"
              value={tax}
              onChange={(e) => setTax(e.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-600"
              placeholder="0.00"
            />
          </div>

          <div className="space-y-1 md:col-span-2">
            <div className="text-xs text-slate-400">Notes</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[92px] w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-600"
              placeholder="Payment terms, thank you note, etc…"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-300">
            Total:{' '}
            <span className="font-semibold text-slate-100">{formatMoney(total)}</span>
            {!businessId ? (
              <span className="ml-2 text-xs text-slate-500">
                Loading business… save disabled
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saveDisabled}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Save invoice'}
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950/30">
        <div className="border-b border-slate-800 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="text-sm font-semibold text-slate-100">All invoices</div>
              <div className="text-xs text-slate-400">
                {totalCount !== null ? `${totalCount} total` : `${invoices.length} loaded`}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setListExpanded((v) => {
                    const next = !v;
                    if (!next) setExpandedRowId(null);
                    return next;
                  });
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900/70"
              >
                {listExpanded ? 'Collapse' : 'Show all invoices'}
              </button>
            </div>
          </div>

          {/* Filters + pagination controls (active in both compact + expanded modes) */}
          <div className="mt-3 grid gap-2 md:grid-cols-12">
            <div className="md:col-span-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search invoice # or client…"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/40 py-2 pl-9 pr-3 text-sm text-slate-100 outline-none focus:border-slate-600"
                />
              </div>
            </div>

            <div className="md:col-span-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-600"
              >
                <option value="all">All statuses</option>
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <input
                type="date"
                value={createdFrom}
                onChange={(e) => setCreatedFrom(e.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-600"
              />
            </div>
            <div className="md:col-span-2">
              <input
                type="date"
                value={createdTo}
                onChange={(e) => setCreatedTo(e.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-600"
              />
            </div>

            <div className="md:col-span-2 flex items-center justify-between gap-2">
              <select
                value={pageSize}
                onChange={(e) => setPageSize((Number(e.target.value) as any) ?? 20)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-600"
              >
                <option value={20}>20 / page</option>
                <option value={50}>50 / page</option>
              </select>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-slate-400">
              Page <span className="text-slate-200">{pageIndex + 1}</span>
              {totalCount !== null ? (
                <>
                  {' '}
                  of <span className="text-slate-200">{Math.max(1, Math.ceil(totalCount / pageSize))}</span>
                </>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                disabled={pageIndex === 0 || loadingList}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900/70 disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />
                Prev
              </button>
              <button
                type="button"
                onClick={() => setPageIndex((p) => p + 1)}
                disabled={!pageHasMore || loadingList}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900/70 disabled:opacity-50"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {loadingList ? (
          <div className="p-4 text-xs text-slate-400">Loading invoices…</div>
        ) : invoices.length === 0 ? (
          <div className="p-6 text-sm text-slate-400">No invoices yet.</div>
        ) : (
          <div className="divide-y divide-slate-800">
            {invoices.map((inv) => (
              <div key={String(inv.id)} className="px-4 py-3">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleRow(inv.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') toggleRow(inv.id);
                  }}
                  className="rounded-xl border border-slate-800 bg-slate-950/20 px-3 py-3 hover:bg-slate-950/30"
                >
                  {/* Compact vs expanded row */}
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-semibold text-slate-100">
                          {inv.invoice_number}
                        </div>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${badgeForStatus(
                            inv.status
                          )}`}
                          style={{ textTransform: 'capitalize' }}
                        >
                          {inv.status}
                        </span>
                      </div>

                      {listExpanded ? (
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                          <span className="truncate">{inv.client_name}</span>
                          <span>•</span>
                          <span>Issue {inv.issue_date || '—'}</span>
                          <span>•</span>
                          <span>Due {inv.due_date || '—'}</span>
                        </div>
                      ) : (
                        <div className="mt-1 truncate text-xs text-slate-400">
                          {inv.client_name}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="mr-1 text-sm font-semibold text-slate-100">
                        {formatMoney(inv.total)}
                      </div>

                      {/* In compact mode, keep actions inside expanded details to reduce clutter */}
                      {listExpanded ? (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              // eslint-disable-next-line no-console
                              console.log('INVOICE_EDIT_CLICK', { id: inv?.id, invoice_number: inv?.invoice_number });
                              beginEdit(inv);
                            }}
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900/70"
                          >
                            <Pencil className="h-4 w-4" />
                            Edit
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void beginPrint(inv);
                            }}
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900/70"
                          >
                            <Printer className="h-4 w-4" />
                            Print
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {/* Inline expanded details */}
                  {String(expandedRowId) === String(inv.id) ? (
                    <div className="mt-3 grid gap-3 rounded-xl border border-slate-800 bg-black/20 p-3 md:grid-cols-3">
                      <div className="md:col-span-2">
                        <div className="text-[11px] font-semibold text-slate-300">Details</div>
                        <div className="mt-1 text-xs text-slate-300">
                          <div>Client: <span className="text-slate-100">{inv.client_name}</span></div>
                          <div>Issue: <span className="text-slate-100">{inv.issue_date || '—'}</span></div>
                          <div>Due: <span className="text-slate-100">{inv.due_date || '—'}</span></div>
                          <div>Created: <span className="text-slate-100">{inv.created_at || '—'}</span></div>
                        </div>
                        <div className="mt-2 text-[11px] font-semibold text-slate-300">Notes</div>
                        <div className="mt-1 text-xs text-slate-300 whitespace-pre-wrap break-words">
                          {formatNotesForDisplay(inv.notes) || '—'}
                        </div>
                      </div>

                      <div className="md:col-span-1">
                        <div className="text-[11px] font-semibold text-slate-300">Totals</div>
                        <div className="mt-1 text-xs text-slate-300 space-y-1">
                          <div className="flex items-center justify-between">
                            <span>Subtotal</span>
                            <span className="text-slate-100">{formatMoney(inv.subtotal)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Tax</span>
                            <span className="text-slate-100">{formatMoney(inv.tax ?? 0)}</span>
                          </div>
                          <div className="mt-2 flex items-center justify-between border-t border-slate-800 pt-2">
                            <span className="font-semibold">Total</span>
                            <span className="font-semibold text-slate-100">{formatMoney(inv.total)}</span>
                          </div>
                        </div>

                        {/* Actions (always available in expanded details) */}
                        <div className="mt-3 flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              // eslint-disable-next-line no-console
                              console.log('INVOICE_EDIT_CLICK', { id: inv?.id, invoice_number: inv?.invoice_number });
                              beginEdit(inv);
                            }}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900/70"
                          >
                            <Pencil className="h-4 w-4" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void beginPrint(inv);
                            }}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900/70"
                          >
                            <Printer className="h-4 w-4" />
                            Print
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


