'use client';

import React from 'react';
import { supabase } from '../../utils/supabaseClient';
import { useSingleBusinessId } from '../../lib/useSingleBusinessId';

type BillStatusFilter = 'ALL' | 'UPCOMING' | 'TODAY' | 'OVERDUE' | 'PAID';

type Bill = {
  id: string;
  business_id: string;
  vendor: string;
  description: string | null;
  category: string | null;
  amount: number;
  issue_date: string;
  due_date: string;
  status: 'OPEN' | 'PAID';
  payment_method?: string | null;
  notes?: string | null;
  paid_at?: string | null;
  is_recurring?: boolean | null;
  recurring_interval?: string | null;
  recurring_next_due_date?: string | null;
  reminder_days_before?: number | null;
};

function BillingSection({
  selectedBusinessId,
}: {
  selectedBusinessId: string | null;
}) {
  const [bills, setBills] = React.useState<Bill[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [filter, setFilter] = React.useState<BillStatusFilter>('ALL');
  const [search, setSearch] = React.useState('');
  const [editingBillId, setEditingBillId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({
    vendor: '',
    description: '',
    category: '',
    amount: '',
    issue_date: '',
    due_date: '',
    payment_method: '',
    notes: '',
    is_recurring: false as boolean | null,
    recurrence_frequency: null as Bill['recurrence_frequency'],
    reminder_days_before: 7 as number | null,
  });

  React.useEffect(() => {
    if (!selectedBusinessId) {
      setBills([]);
      return;
    }
    setLoading(true);
    supabase
      .from('bills')
      .select('*')
      .eq('business_id', selectedBusinessId)
      .order('due_date', { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          setBills([]);
        } else {
          const rows = (data ?? []) as any[];
          const mapped: Bill[] = rows.map((row) => ({
            id: String(row.id),
            business_id: row.business_id,
            vendor: row.vendor,
            description: row.description ?? null,
            category: row.category ?? null,
            amount: Number(row.amount) || 0,
            issue_date: row.issue_date,
            due_date: row.due_date,
            status: row.status === 'PAID' ? 'PAID' : 'OPEN',
            payment_method: row.payment_method ?? null,
            notes: row.notes ?? null,
            paid_at: row.paid_at ?? null,
            is_recurring: row.is_recurring ?? false,
            recurring_interval: row.recurring_interval ?? null,
            recurring_next_due_date: row.recurring_next_due_date ?? null,
            reminder_days_before:
              row.reminder_days_before !== null &&
              row.reminder_days_before !== undefined
                ? Number(row.reminder_days_before)
                : null,
          }));
          setBills(mapped);
        }
      })
      .finally(() => setLoading(false));
  }, [selectedBusinessId]);

  const today = new Date();

  function getComputedStatus(
    bill: Bill
  ): 'UPCOMING' | 'TODAY' | 'OVERDUE' | 'PAID' {
    if (bill.status === 'PAID') return 'PAID';
    const due = new Date(bill.due_date);
    const isSameDay = due.toDateString() === today.toDateString();
    if (due < today && !isSameDay) return 'OVERDUE';
    if (isSameDay) return 'TODAY';
    return 'UPCOMING';
  }

  function daysDiff(from: Date, to: Date) {
    const ms = to.getTime() - from.getTime();
    return Math.round(ms / (1000 * 60 * 60 * 24));
  }

  const filteredBills = bills.filter((bill) => {
    const status = getComputedStatus(bill);
    if (filter === 'UPCOMING' && status !== 'UPCOMING') return false;
    if (filter === 'TODAY' && status !== 'TODAY') return false;
    if (filter === 'OVERDUE' && status !== 'OVERDUE') return false;
    if (filter === 'PAID' && status !== 'PAID') return false;

    if (search.trim()) {
      const q = search.toLowerCase();
      const hitVendor = bill.vendor.toLowerCase().includes(q);
      const hitDesc = (bill.description ?? '').toLowerCase().includes(q);
      if (!hitVendor && !hitDesc) return false;
    }

    return true;
  });

  const totalOutstanding = bills
    .filter((b) => b.status === 'OPEN')
    .reduce((sum, b) => sum + b.amount, 0);

  const dueThisWeek = bills
    .filter((b) => {
      if (b.status !== 'OPEN') return false;
      const due = new Date(b.due_date);
      const diff = daysDiff(today, due);
      return diff >= 0 && diff <= 7;
    })
    .reduce((sum, b) => sum + b.amount, 0);

  const overdueTotal = bills
    .filter((b) => {
      if (b.status !== 'OPEN') return false;
      const due = new Date(b.due_date);
      const isSameDay = due.toDateString() === today.toDateString();
      return due < today && !isSameDay;
    })
    .reduce((sum, b) => sum + b.amount, 0);

  const nextBill = bills
    .filter((b) => b.status === 'OPEN')
    .sort(
      (a, b) =>
        new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
    )[0];

  const upcomingRecurring = bills.filter((b) => {
    if (!b.is_recurring || !b.due_date) return false;
    const due = new Date(b.due_date);
    const diffMs = due.getTime() - today.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const reminderDays = b.reminder_days_before ?? 7;
    return diffDays >= 0 && diffDays <= reminderDays;
  });

  const upcomingAmount = upcomingRecurring.reduce(
    (sum, b) => sum + Number(b.amount || 0),
    0
  );

  function handleFormChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSaveBill(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBusinessId) return;

    const payload = {
      business_id: selectedBusinessId,
      vendor: form.vendor.trim(),
      description: form.description.trim() || null,
      category: form.category.trim() || null,
      amount: parseFloat(form.amount || '0'),
      issue_date: form.issue_date,
      due_date: form.due_date,
      payment_method: form.payment_method.trim() || null,
      notes: form.notes.trim() || null,
    };

    // eslint-disable-next-line no-console
    console.log('selectedBusinessId in BillingSection:', selectedBusinessId);
    // eslint-disable-next-line no-console
    console.log('Saving bill payload:', payload);

    if (
      !payload.vendor ||
      !payload.amount ||
      !payload.due_date ||
      !payload.issue_date
    ) {
      alert('Vendor, amount, issue date, and due date are required.');
      return;
    }

    let res;
    if (editingBillId) {
      res = await supabase
        .from('bills')
        .update(payload)
        .eq('id', editingBillId)
        .select('*');
    } else {
      res = await supabase.from('bills').insert(payload).select('*');
    }

    const { data, error } = res;
    if (error) {
      // eslint-disable-next-line no-console
      console.error('Error saving bill', error);
      alert('Could not save bill: ' + error.message);
      return;
    }

    const saved = (data ?? [])[0] as any;
    const savedBill: Bill = {
      id: String(saved.id),
      business_id: saved.business_id,
      vendor: saved.vendor,
      description: saved.description ?? null,
      category: saved.category ?? null,
      amount: Number(saved.amount) || 0,
      issue_date: saved.issue_date,
      due_date: saved.due_date,
      status: saved.status === 'PAID' ? 'PAID' : 'OPEN',
      payment_method: saved.payment_method ?? null,
      notes: saved.notes ?? null,
      paid_at: saved.paid_at ?? null,
      is_recurring: saved.is_recurring ?? false,
      recurring_interval: saved.recurring_interval ?? null,
      recurring_next_due_date: saved.recurring_next_due_date ?? null,
      reminder_days_before:
        saved.reminder_days_before !== null &&
        saved.reminder_days_before !== undefined
          ? Number(saved.reminder_days_before)
          : null,
    };

    setBills((prev) => {
      if (editingBillId) {
        return prev.map((b) => (b.id === editingBillId ? savedBill : b));
      }
      return [...prev, savedBill].sort(
        (a, b) =>
          new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
      );
    });

    setEditingBillId(null);
    setForm({
      vendor: '',
      description: '',
      category: '',
      amount: '',
      issue_date: '',
      due_date: '',
      payment_method: '',
      notes: '',
      is_recurring: false,
      recurrence_frequency: null,
      reminder_days_before: 7,
    });
  }

  function startEdit(bill: Bill) {
    setEditingBillId(bill.id);
    setForm({
      vendor: bill.vendor,
      description: bill.description ?? '',
      category: bill.category ?? '',
      amount: bill.amount.toString(),
      issue_date: bill.issue_date,
      due_date: bill.due_date,
      payment_method: bill.payment_method ?? '',
      notes: bill.notes ?? '',
      is_recurring: bill.is_recurring ?? false,
      recurrence_frequency: bill.recurrence_frequency ?? null,
      reminder_days_before: bill.reminder_days_before ?? 7,
    });
  }

  async function markPaid(bill: Bill) {
    const updatingToPaid = bill.status !== 'PAID';
    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from('bills')
      .update({
        status: updatingToPaid ? 'PAID' : 'OPEN',
        paid_at: updatingToPaid ? nowIso : null,
      })
      .eq('id', bill.id)
      .select('*');

    if (error) {
      // eslint-disable-next-line no-console
      console.error('Error toggling paid status', error);
      alert('Could not update paid status: ' + error.message);
      return;
    }

    const updated = (data ?? [])[0] as Bill;
    setBills((prev) => prev.map((b) => (b.id === bill.id ? updated : b)));
  }

  async function toggleRecurring(bill: Bill) {
    // If it's already recurring → turn it OFF
    if (bill.is_recurring) {
      const { data, error } = await supabase
        .from('bills')
        .update({
          is_recurring: false,
          recurring_interval: null,
          recurring_next_due_date: null,
        })
        .eq('id', bill.id)
        .select('*');

      if (error) {
        // eslint-disable-next-line no-console
        console.error('Error turning off recurring', error);
        alert('Could not update recurring: ' + error.message);
        return;
      }

      const updated = (data ?? [])[0] as Bill;
      setBills((prev) => prev.map((b) => (b.id === bill.id ? updated : b)));
      return;
    }

    // If it's NOT recurring → turn it ON (monthly by default)
    const currentDue = new Date(bill.due_date);
    const nextDue = new Date(currentDue);
    if (!Number.isNaN(nextDue.getTime())) {
      nextDue.setMonth(nextDue.getMonth() + 1);
    }

    const { data, error } = await supabase
      .from('bills')
      .update({
        is_recurring: true,
        recurring_interval: bill.recurring_interval ?? 'monthly',
        recurring_next_due_date: !Number.isNaN(nextDue.getTime())
          ? nextDue.toISOString().slice(0, 10)
          : null,
      })
      .eq('id', bill.id)
      .select('*');

    if (error) {
      // eslint-disable-next-line no-console
      console.error('Error turning on recurring', error);
      alert('Could not update recurring: ' + error.message);
      return;
    }

    const updated = (data ?? [])[0] as Bill;
    setBills((prev) => prev.map((b) => (b.id === bill.id ? updated : b)));
  }

  function formatCurrency(n: number) {
    return n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-2xl border bg-slate-950/80 border-slate-800 p-3">
          <p className="text-xs text-slate-400">Total Outstanding</p>
          <p className="text-lg font-semibold text-slate-50">
            ${formatCurrency(totalOutstanding)}
          </p>
        </div>
        <div className="rounded-2xl border bg-slate-950/80 border-slate-800 p-3">
          <p className="text-xs text-slate-400">Due This Week</p>
          <p className="text-lg font-semibold text-slate-50">
            ${formatCurrency(dueThisWeek)}
          </p>
        </div>
        <div className="rounded-2xl border bg-slate-950/80 border-slate-800 p-3">
          <p className="text-xs text-slate-400">Overdue</p>
          <p className="text-lg font-semibold text-rose-400">
            ${formatCurrency(overdueTotal)}
          </p>
        </div>
        <div className="rounded-2xl border bg-slate-950/80 border-slate-800 p-3">
          <p className="text-xs text-slate-400">Next Bill Due</p>
          {nextBill ? (
            <p className="text-sm font-semibold text-slate-50">
              {nextBill.vendor} · {nextBill.due_date}
            </p>
          ) : (
            <p className="text-sm text-slate-500">No upcoming bills</p>
          )}
        </div>
      </div>

      {upcomingRecurring.length > 0 && (
        <div className="mt-1 rounded-lg border border-amber-500/40 bg-amber-900/20 px-3 py-2 text-xs text-amber-100">
          <div className="font-semibold">
            Upcoming recurring bills ({upcomingRecurring.length})
          </div>
          <div className="text-[11px]">
            Due within next{' '}
            {upcomingRecurring[0].reminder_days_before ?? 7} days · Total:{' '}
            ${upcomingAmount.toFixed(2)}
          </div>
        </div>
      )}

      {/* Filters + search */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex flex-wrap gap-2">
          {[
            { key: 'ALL', label: 'All' },
            { key: 'UPCOMING', label: 'Upcoming' },
            { key: 'TODAY', label: 'Due Today' },
            { key: 'OVERDUE', label: 'Overdue' },
            { key: 'PAID', label: 'Paid' },
          ].map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key as BillStatusFilter)}
              className={`px-3 py-1 rounded-full text-xs border ${
                filter === f.key
                  ? 'bg-emerald-500 text-slate-950 border-emerald-500'
                  : 'bg-slate-900 text-slate-200 border-slate-700 hover:bg-slate-800'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search vendor or description..."
          className="border border-slate-700 bg-slate-900 text-slate-100 rounded-full px-3 py-1 text-xs w-full sm:w-64"
        />
      </div>

      {/* Bills table */}
      <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/80">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-xs text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Vendor</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-left">Category</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-left">Due Date</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Days</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-4 text-center text-xs text-slate-500"
                >
                  Loading bills...
                </td>
              </tr>
            )}
            {!loading && filteredBills.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-4 text-center text-xs text-slate-500"
                >
                  No bills to show.
                </td>
              </tr>
            )}
            {!loading &&
              filteredBills.map((bill) => {
                const status = getComputedStatus(bill);
                const due =
                  bill.due_date && !Number.isNaN(new Date(bill.due_date).getTime())
                    ? new Date(bill.due_date)
                    : null;

                let rowClass = '';
                if (status === 'OVERDUE') rowClass = 'bg-rose-950/40';
                else if (status === 'TODAY') rowClass = 'bg-amber-950/40';
                else if (status === 'PAID')
                  rowClass = 'bg-slate-900/80 text-slate-500';

                let daysText = '–';
                if (due) {
                  const diff = daysDiff(today, due);
                  if (status === 'UPCOMING') daysText = `${diff} days`;
                  else if (status === 'TODAY') daysText = 'Due today';
                  else if (status === 'OVERDUE')
                    daysText = `${Math.abs(diff)} days late`;
                }

                return (
                  <tr key={bill.id} className={rowClass}>
                    <td className="px-3 py-2">{bill.vendor}</td>
                    <td className="px-3 py-2">{bill.description}</td>
                    <td className="px-3 py-2">{bill.category}</td>
                    <td className="px-3 py-2 text-right">
                      ${formatCurrency(bill.amount)}
                    </td>
                    <td className="px-3 py-2">{bill.due_date}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ' +
                          (status === 'OVERDUE'
                            ? 'bg-rose-900 text-rose-200'
                            : status === 'TODAY'
                            ? 'bg-amber-900 text-amber-100'
                            : status === 'UPCOMING'
                            ? 'bg-emerald-900 text-emerald-200'
                            : 'bg-slate-700 text-slate-200')
                        }
                      >
                        {status === 'UPCOMING'
                          ? 'Upcoming'
                          : status === 'TODAY'
                          ? 'Due Today'
                          : status === 'OVERDUE'
                          ? 'Overdue'
                          : 'Paid'}
                      </span>
                    </td>
                    <td className="px-3 py-2">{daysText}</td>
                    <td className="px-3 py-2 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => toggleRecurring(bill)}
                        className={
                          'text-xs px-3 py-1 rounded-full border transition ' +
                          (bill.is_recurring
                            ? 'bg-green-500 text-black border-green-500'
                            : 'bg-transparent text-green-400 border-green-400')
                        }
                      >
                        {bill.is_recurring ? 'Recurring' : 'Set Recurring'}
                      </button>

                      <button
                        type="button"
                        onClick={() => markPaid(bill)}
                        className={
                          'text-xs px-2 py-1 rounded-full border transition ' +
                          (bill.status === 'PAID'
                            ? 'bg-blue-500 text-white border-blue-500'
                            : 'bg-transparent text-blue-400 border-blue-400')
                        }
                      >
                        {bill.status === 'PAID' ? 'Mark Unpaid' : 'Mark Paid'}
                      </button>

                      <button
                        type="button"
                        onClick={() => startEdit(bill)}
                        className="text-xs px-2 py-1 rounded-full border"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Add / Edit form */}
      <form
        onSubmit={handleSaveBill}
        className="border border-slate-800 rounded-2xl p-4 space-y-3 bg-slate-950/80"
      >
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold text-slate-100">
            {editingBillId ? 'Edit Bill' : 'Add Bill'}
          </h3>
          {editingBillId && (
            <button
              type="button"
              onClick={() => {
                setEditingBillId(null);
                setForm({
                  vendor: '',
                  description: '',
                  category: '',
                  amount: '',
                  issue_date: '',
                  due_date: '',
                  payment_method: '',
                  notes: '',
                });
              }}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              Cancel
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-300">Vendor</label>
            <input
              name="vendor"
              value={form.vendor}
              onChange={handleFormChange}
              placeholder="Vendor *"
              className="border border-slate-700 bg-slate-900 rounded-lg px-3 py-2 text-slate-100"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-300">Category</label>
            <input
              name="category"
              value={form.category}
              onChange={handleFormChange}
              placeholder="Category"
              className="border border-slate-700 bg-slate-900 rounded-lg px-3 py-2 text-slate-100"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-300">Amount</label>
            <input
              name="amount"
              value={form.amount}
              onChange={handleFormChange}
              placeholder="Amount *"
              type="number"
              step="0.01"
              className="border border-slate-700 bg-slate-900 rounded-lg px-3 py-2 text-slate-100"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-300">Bill Date</label>
            <input
              name="issue_date"
              value={form.issue_date}
              onChange={handleFormChange}
              type="date"
              placeholder="Select bill date"
              className="border border-slate-700 bg-slate-900 rounded-lg px-3 py-2 text-slate-100"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-300">Due Date</label>
            <input
              name="due_date"
              value={form.due_date}
              onChange={handleFormChange}
              type="date"
              placeholder="Select due date"
              className="border border-slate-700 bg-slate-900 rounded-lg px-3 py-2 text-slate-100"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-300">Payment Method</label>
            <input
              name="payment_method"
              value={form.payment_method}
              onChange={handleFormChange}
              placeholder="Payment method"
              className="border border-slate-700 bg-slate-900 rounded-lg px-3 py-2 text-slate-100"
            />
          </div>
        </div>
        <textarea
          name="description"
          value={form.description}
          onChange={handleFormChange}
          placeholder="Description"
          className="border border-slate-700 bg-slate-900 rounded-lg px-3 py-2 text-xs w-full text-slate-100"
        />
        <textarea
          name="notes"
          value={form.notes}
          onChange={handleFormChange}
          placeholder="Notes"
          className="border border-slate-700 bg-slate-900 rounded-lg px-3 py-2 text-xs w-full text-slate-100"
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-full text-xs bg-emerald-500 text-slate-950 hover:bg-emerald-400"
        >
          {editingBillId ? 'Save Changes' : 'Add Bill'}
        </button>
      </form>
    </div>
  );
}

export default function BillsPage() {
  const { businessId: selectedBusinessId, loading: businessLoading, error: businessError } =
    useSingleBusinessId();

  return (
    <main className="space-y-4">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
            <p className="text-slate-400 text-sm mt-1">
              See all upcoming bills, what&apos;s overdue, and plan payments with
              confidence.
            </p>
          </div>
        </header>

        {businessError && <div className="text-xs text-rose-300">{businessError}</div>}
        {businessLoading && <div className="text-xs text-slate-400">Loading business…</div>}

        <BillingSection selectedBusinessId={selectedBusinessId} />
    </main>
  );
}
