'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabaseClient';

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

type Props = {
  // Kept for compatibility with `app/invoices/page.tsx`, but this component
  // self-resolves user + businessId per requirements.
  businessId?: string | null;
  businessName?: string;
  invoices?: any[];
  userId?: string | null;
  loading?: boolean;
  error?: string | null;
};

function tryConsoleLog(...args: any[]) {
  // Some environments can throw on console usage; never let that crash the UI.
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

export default function InvoiceTab(_props: Props) {
  const [booting, setBooting] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);

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
  }

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      setBooting(true);
      setError(null);

      // On mount, get session user; if no user -> show “Please sign in”.
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
      storeDebug('InvoiceTab user.id', user.id);
      tryConsoleLog('InvoiceTab user.id', user.id);

      // Fetch business id with from('business').select('id').eq('owner_id', user.id).single().
      const { data: biz, error: bizErr } = await supabase
        .from('business')
        .select('id')
        .eq('owner_id', user.id)
        .single();

      if (cancelled) return;

      if (!bizErr && biz?.id) {
        setBusinessId(biz.id);
        storeDebug('InvoiceTab businessId', biz.id);
        tryConsoleLog('InvoiceTab businessId', biz.id);
        await refetchInvoices(biz.id);
        setBooting(false);
        return;
      }

      // If no business row, create one.
      const { data: created, error: createErr } = await supabase
        .from('business')
        .insert({ owner_id: user.id, name: 'My Business' })
        .select('id')
        .single();

      if (cancelled) return;

      if (createErr || !created?.id) {
        setError(createErr?.message || 'No business found and failed to create one.');
        setBooting(false);
        return;
      }

      setBusinessId(created.id);
      storeDebug('InvoiceTab created businessId', created.id);
      tryConsoleLog('InvoiceTab created businessId', created.id);
      await refetchInvoices(created.id);
      setBooting(false);
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveDisabled = !businessId || saving || booting;

  async function handleSaveInvoice() {
    setError(null);

    if (!userId) {
      setError('Please sign in.');
      return;
    }

    if (!businessId) {
      setError('Business is still loading. Please wait.');
      return;
    }

    if (!clientName.trim()) {
      setError('Client name is required.');
      return;
    }

    const invNum = (invoiceNumber || '').trim() || `INV-${Date.now()}`;
    const s = Number(subtotal);
    const t = Number(tax);
    const safeSubtotal = Number.isFinite(s) ? s : 0;
    const safeTax = Number.isFinite(t) ? t : 0;

    // On save, insert into invoices ALWAYS with business_id: businessId and all fields.
    const payload = {
      business_id: businessId,
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

    setSaving(true);
    try {
      const { data: inserted, error: insErr } = await supabase
        .from('invoices')
        .insert(payload)
        .select('*')
        .single();

      if (insErr || !inserted) {
        // Add console logs for user.id, businessId, and payload if insert fails.
        tryConsoleLog('Invoice insert failed user.id', userId);
        tryConsoleLog('Invoice insert failed businessId', businessId);
        tryConsoleLog('Invoice insert failed payload', payload);
        storeDebug('Invoice insert failed user.id', userId);
        storeDebug('Invoice insert failed businessId', businessId);
        storeDebug('Invoice insert failed payload', payload);
        storeDebug('Invoice insert failed error', insErr);

        setError(insErr?.message || 'Could not save invoice.');
        return;
      }

      // After insert, refetch invoices list filtered by business_id.
      await refetchInvoices(businessId);

      // Clear form
      setInvoiceNumber('');
      setClientName('');
      setIssueDate('');
      setDueDate('');
      setStatus('draft');
      setSubtotal('0');
      setTax('0');
      setNotes('');
    } finally {
      setSaving(false);
    }
  }

  if (!booting && !userId) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-4 text-sm text-slate-200">
        Please sign in.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {booting ? <div className="text-xs text-slate-400">Loading…</div> : null}

      {error ? (
        <div className="rounded-xl border border-rose-900/50 bg-rose-950/40 p-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 rounded-2xl border border-slate-700 bg-[#0B1220] p-4 md:grid-cols-2">
        <div className="space-y-1">
          <div className="text-xs text-slate-400">Invoice #</div>
          <input
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
            placeholder="INV-1001 (optional)"
          />
        </div>

        <div className="space-y-1">
          <div className="text-xs text-slate-400">Client name *</div>
          <input
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
            placeholder="Acme Co."
          />
        </div>

        <div className="space-y-1">
          <div className="text-xs text-slate-400">Issue date</div>
          <input
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
          />
        </div>

        <div className="space-y-1">
          <div className="text-xs text-slate-400">Due date</div>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
          />
        </div>

        <div className="space-y-1">
          <div className="text-xs text-slate-400">Status</div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as InvoiceStatus)}
            className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
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
            className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
            placeholder="0.00"
          />
        </div>

        <div className="space-y-1">
          <div className="text-xs text-slate-400">Tax</div>
          <input
            inputMode="decimal"
            value={tax}
            onChange={(e) => setTax(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
            placeholder="0.00"
          />
        </div>

        <div className="space-y-1 md:col-span-2">
          <div className="text-xs text-slate-400">Notes</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="min-h-[80px] w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
            placeholder="Optional notes..."
          />
        </div>

        <div className="flex items-center justify-between md:col-span-2">
          <div className="text-sm text-slate-300">
            Total: <span className="font-semibold text-slate-100">${total.toFixed(2)}</span>
          </div>
          <button
            onClick={handleSaveInvoice}
            disabled={saveDisabled}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Invoice'}
          </button>
        </div>

        {!businessId ? (
          <div className="md:col-span-2 text-xs text-slate-400">
            Loading business… Save is disabled until your business is ready.
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-100">Invoices</div>
          <div className="text-xs text-slate-400">{businessId ? `Business: ${businessId}` : ''}</div>
        </div>

        {invoices.length === 0 ? (
          <div className="text-sm text-slate-400">No invoices yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-400">
                <tr className="border-b border-slate-700">
                  <th className="py-2 pr-3">Invoice</th>
                  <th className="py-2 pr-3">Client</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Total</th>
                  <th className="py-2 pr-3">Due</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={String(inv.id)} className="border-b border-slate-800/70">
                    <td className="py-2 pr-3 font-medium text-slate-100">{inv.invoice_number}</td>
                    <td className="py-2 pr-3 text-slate-200">{inv.client_name}</td>
                    <td className="py-2 pr-3 text-slate-300">{inv.status}</td>
                    <td className="py-2 pr-3 text-slate-200">${Number(inv.total || 0).toFixed(2)}</td>
                    <td className="py-2 pr-3 text-slate-300">{inv.due_date || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}


