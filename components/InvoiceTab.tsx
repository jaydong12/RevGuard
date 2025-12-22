'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  FileText,
  Pencil,
  Printer,
  Save,
  Plus,
  X,
  RefreshCw,
} from 'lucide-react';
import { supabase } from '../utils/supabaseClient';
import { getOrCreateBusinessId } from '../lib/getOrCreateBusinessId';

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
  created_at: string;
};

type BusinessInfo = {
  id: string;
  owner_id?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
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

function buildPrintHtml(biz: BusinessInfo | null, inv: InvoiceRow) {
  const name = biz?.name || 'My Business';
  const lines: string[] = [];
  if (biz?.address) lines.push(biz.address);
  const cityLine = [biz?.city, biz?.state, biz?.postal_code].filter(Boolean).join(', ');
  if (cityLine) lines.push(cityLine);
  if (biz?.country) lines.push(biz.country);

  const contact = [biz?.email, biz?.phone].filter(Boolean).join(' • ');

  const issue = inv.issue_date ? inv.issue_date : '—';
  const due = inv.due_date ? inv.due_date : '—';

  const esc = (s: any) =>
    String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Invoice ${esc(inv.invoice_number)}</title>
  <style>
    @page { margin: 16mm; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; color: #0f172a; }
    .row { display:flex; justify-content:space-between; gap:24px; }
    .muted { color:#475569; font-size: 12px; }
    .h1 { font-size: 22px; font-weight: 800; margin:0; }
    .h2 { font-size: 14px; font-weight: 700; margin:0; }
    .card { border:1px solid #e2e8f0; border-radius: 12px; padding: 14px; }
    table { width:100%; border-collapse: collapse; margin-top: 12px; }
    th { text-align:left; font-size: 12px; color:#64748b; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
    td { padding: 10px 0; border-bottom: 1px dashed #e2e8f0; font-size: 13px; }
    .right { text-align:right; }
    .total { font-size: 16px; font-weight: 800; }
    .top { margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="top row">
    <div>
      <p class="h1">${esc(name)}</p>
      ${contact ? `<div class="muted">${esc(contact)}</div>` : ''}
      ${lines.length ? `<div class="muted">${lines.map(esc).join('<br/>')}</div>` : ''}
    </div>
    <div style="text-align:right;">
      <p class="h1">Invoice</p>
      <div class="muted"># ${esc(inv.invoice_number)}</div>
      <div class="muted">Issue: ${esc(issue)}</div>
      <div class="muted">Due: ${esc(due)}</div>
      <div class="muted" style="text-transform:capitalize;">Status: ${esc(inv.status)}</div>
    </div>
  </div>

  <div class="card">
    <div class="row">
      <div>
        <p class="h2">Bill To</p>
        <div style="margin-top:6px; font-size: 14px; font-weight: 700;">${esc(inv.client_name)}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th class="right">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Services</td>
          <td class="right">${esc(formatMoney(inv.subtotal))}</td>
        </tr>
        <tr>
          <td>Tax</td>
          <td class="right">${esc(formatMoney(inv.tax ?? 0))}</td>
        </tr>
        <tr>
          <td class="total">Total</td>
          <td class="right total">${esc(formatMoney(inv.total))}</td>
        </tr>
      </tbody>
    </table>

    ${
      inv.notes
        ? `<div style="margin-top:14px;"><div class="muted" style="font-weight:700;">Notes</div><div style="margin-top:6px; white-space:pre-wrap;">${esc(inv.notes)}</div></div>`
        : ''
    }
  </div>
</body>
</html>`;
}

export default function InvoiceTab(_props: Props) {
  const [booting, setBooting] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSupabaseError, setLastSupabaseError] = useState<any | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businessInfo, setBusinessInfo] = useState<BusinessInfo | null>(null);

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);

  // Edit mode
  const [editingId, setEditingId] = useState<any | null>(null);

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

  async function refetchInvoices(bizId: string) {
    setLoadingList(true);
    try {
      const { data, error: invErr } = await supabase
        .from('invoices')
        .select('*')
        .eq('business_id', bizId)
        .order('created_at', { ascending: false });

      if (invErr) {
        setError(invErr.message || 'Failed to load invoices.');
        return;
      }

      setInvoices(((data ?? []) as any[]) as InvoiceRow[]);
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
    setEditingId(inv.id);
    setInvoiceNumber(inv.invoice_number ?? '');
    setClientName(inv.client_name ?? '');
    setIssueDate(safeDate(inv.issue_date));
    setDueDate(safeDate(inv.due_date));
    setStatus((inv.status as InvoiceStatus) ?? 'draft');
    setSubtotal(String(inv.subtotal ?? 0));
    setTax(String(inv.tax ?? 0));
    setNotes(inv.notes ?? '');
  }

  async function handlePrint(inv: InvoiceRow) {
    const html = buildPrintHtml(businessInfo, inv);
    const w = window.open('', '_blank', 'noopener,noreferrer');
    if (!w) {
      setError('Popup blocked. Allow popups to print.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    // Give the browser a tick to render before printing
    setTimeout(() => {
      try {
        w.print();
      } catch {
        // ignore
      }
    }, 250);
  }

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
      await Promise.all([refetchInvoices(bizId), fetchBusinessInfo(bizId)]);
      setBooting(false);
    }

    void boot();

    return () => {
      cancelled = true;
    };
  }, []);

  const saveDisabled = !businessId || saving || booting;

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

    const invNum = (invoiceNumber || '').trim() || `INV-${Date.now()}`;
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
      status,
      subtotal: safeSubtotal,
      tax: safeTax,
      total: safeSubtotal + safeTax,
      notes: notes.trim() ? notes.trim() : null,
    };

    tryConsoleLog('Invoice save payload', payload);
    storeDebug('Invoice save payload', payload);

    setSaving(true);
    try {
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
      }

      await refetchInvoices(businessIdToUse);
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
  const bizMeta = [businessInfo?.email, businessInfo?.phone].filter(Boolean).join(' • ');

  return (
    <div className="space-y-4">
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
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-500/25">
              <FileText className="h-5 w-5" />
            </div>
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
              onClick={() => businessId && refetchInvoices(businessId)}
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
      <div className="rounded-2xl border border-slate-800 bg-[#0B1220] p-5">
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
        <div className="flex items-center justify-between border-b border-slate-800 p-4">
          <div className="text-sm font-semibold text-slate-100">All invoices</div>
          <div className="text-xs text-slate-400">{invoices.length} total</div>
        </div>

        {loadingList ? (
          <div className="p-4 text-xs text-slate-400">Loading invoices…</div>
        ) : invoices.length === 0 ? (
          <div className="p-6 text-sm text-slate-400">No invoices yet.</div>
        ) : (
          <div className="divide-y divide-slate-800">
            {invoices.map((inv) => (
              <div key={String(inv.id)} className="p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
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
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                      <span className="truncate">{inv.client_name}</span>
                      <span>•</span>
                      <span>Issue {inv.issue_date || '—'}</span>
                      <span>•</span>
                      <span>Due {inv.due_date || '—'}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="mr-2 text-sm font-semibold text-slate-100">
                      {formatMoney(inv.total)}
                    </div>

                    <button
                      type="button"
                      onClick={() => beginEdit(inv)}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900/70"
                    >
                      <Pencil className="h-4 w-4" />
                      Edit
                    </button>

                    <button
                      type="button"
                      onClick={() => handlePrint(inv)}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900/70"
                    >
                      <Printer className="h-4 w-4" />
                      Print
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


