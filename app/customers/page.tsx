'use client';

import React from 'react';
import { supabase } from '../../utils/supabaseClient';
import { useQueryClient } from '@tanstack/react-query';
import { useAppData } from '../../components/AppDataProvider';

type Customer = {
  id: string;
  business_id: string | null;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  billing_terms: string | null;
  status: string | null;
  notes: string | null;
  balance: number | null;
  last_invoice_date: string | null;
  created_at: string;
};

const initialCustomerForm = {
  name: '',
  company: '',
  email: '',
  phone: '',
  billing_terms: '',
  status: 'Active',
  notes: '',
  balance: '0',
  last_invoice_date: '',
};

const CustomersSection: React.FC = () => {
  const queryClient = useQueryClient();
  const {
    businessId: selectedBusinessId,
    userId,
    customers: customersRaw,
    loading,
    error: loadError,
  } = useAppData();

  const customers = (customersRaw as any[]) as Customer[];
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [isCreating, setIsCreating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [editingCustomer, setEditingCustomer] =
    React.useState<Customer | null>(null);

  const [form, setForm] =
    React.useState<typeof initialCustomerForm>(initialCustomerForm);

  const effectiveError = error || loadError;

  const handleInputChange = (
    e:
      | React.ChangeEvent<HTMLInputElement>
      | React.ChangeEvent<HTMLTextAreaElement>
      | React.ChangeEvent<HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBusinessId) {
      setError('Loading your business…');
      return;
    }

    if (!form.name.trim()) {
      setError('Customer name is required.');
      return;
    }

    setSaving(true);
    setError(null);

    const userIdToUse = userId ?? null;
    if (!userIdToUse) {
      setError('Please log in to save customers.');
      setSaving(false);
      return;
    }

    const payload = {
      business_id: selectedBusinessId ?? null,
      name: form.name.trim(),
      company: form.company.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      billing_terms: form.billing_terms.trim() || null,
      status: form.status || 'ACTIVE',
      notes: form.notes.trim() || null,
      balance: form.balance ? parseFloat(form.balance) : 0,
      last_invoice_date: form.last_invoice_date || null,
    };

    let res;
    if (editingCustomer) {
      res = await supabase
        .from('customers')
        .update(payload)
        .eq('id', editingCustomer.id)
        .eq('business_id', selectedBusinessId)
        .select('*');
    } else {
      res = await supabase.from('customers').insert(payload).select('*');
    }

    const { data, error } = res;
    if (error) {
      // eslint-disable-next-line no-console
      console.error('Error saving customer', error);
      alert('Could not save customer: ' + error.message);
      setSaving(false);
      return;
    }

    await queryClient.invalidateQueries({ queryKey: ['customers', selectedBusinessId] });

    setEditingCustomer(null);
    setForm({
      name: '',
      company: '',
      email: '',
      phone: '',
      billing_terms: 'Net 30',
      status: 'active',
      notes: '',
      balance: '0',
      last_invoice_date: '',
    });
    setIsCreating(false);
    setSaving(false);
  };

  const filteredCustomers = customers.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.name?.toLowerCase().includes(q) ||
      c.company?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.phone?.toLowerCase().includes(q)
    );
  });

  function getTermDays(terms: string | null): number | null {
    if (!terms) return null;
    const lower = terms.toLowerCase().trim();
    if (lower.includes('due on receipt')) return 0;
    const match = lower.match(/net\s+(\d+)/);
    if (match) return parseInt(match[1], 10);
    return null;
  }

  function getCustomerDueText(customer: Customer): string {
    if (!customer.last_invoice_date) return 'No recent invoice';
    const termDays = getTermDays(customer.billing_terms);
    if (termDays === null) return 'No terms set';

    const invoiceDate = new Date(customer.last_invoice_date);
    if (Number.isNaN(invoiceDate.getTime())) return 'Invalid invoice date';

    const dueDate = new Date(invoiceDate);
    dueDate.setDate(dueDate.getDate() + termDays);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    dueDate.setHours(0, 0, 0, 0);

    const diffMs = dueDate.getTime() - today.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays > 0)
      return `Due in ${diffDays} day${diffDays === 1 ? '' : 's'}`;
    if (diffDays === 0) return 'Due today';
    return `Overdue by ${Math.abs(diffDays)} day${
      diffDays === -1 ? '' : 's'
    }`;
  }

  function formatPhone(raw: string): string {
    const digits = raw.replace(/\D/g, '').slice(0, 10);
    const len = digits.length;
    if (len === 0) return '';
    if (len < 4) {
      return `(${digits}`;
    } else if (len < 7) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    }
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-50">
            Customers
          </h2>
          <p className="text-sm text-slate-400">
            Keep a clean, premium rolodex of every client you work with.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative">
            <input
              type="text"
              placeholder="Search by name, company, email..."
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500 sm:w-64"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setEditingCustomer(null);
              setForm(initialCustomerForm);
              setIsCreating(true);
            }}
            className="inline-flex items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 shadow-sm hover:bg-emerald-400"
          >
            + New customer
          </button>
        </div>
      </div>

      {/* Stats / quick summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Total customers
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-50">
            {customers.length}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Active
          </p>
          <p className="mt-2 text-2xl font-semibold text-emerald-400">
            {
              customers.filter(
                (c) => c.status?.toLowerCase() === 'active'
              ).length
            }
          </p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Prospects
          </p>
          <p className="mt-2 text-2xl font-semibold text-amber-400">
            {
              customers.filter(
                (c) => c.status?.toLowerCase() === 'prospect'
              ).length
            }
          </p>
        </div>
      </div>

      {effectiveError && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {effectiveError}
        </div>
      )}

      {loading && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-6 text-sm text-slate-400">
          Loading customers…
        </div>
      )}

      {!loading && filteredCustomers.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/60 px-4 py-10 text-center text-sm text-slate-400">
          No customers yet. Click{' '}
          <span className="font-medium text-emerald-400">“New customer”</span>{' '}
          to add your first client.
        </div>
      )}

      {/* Customer grid */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredCustomers.map((c) => {
          const initials = c.name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();

          return (
            <div
              key={c.id}
              className="group flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-500/50 hover:shadow-md hover:shadow-emerald-500/20"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-semibold text-emerald-300">
                  {initials}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold leading-tight text-slate-50">
                        {c.name}
                      </p>
                      {c.company && (
                        <p className="text-xs text-slate-400">{c.company}</p>
                      )}
                    </div>
                    {c.status && (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          c.status === 'active'
                            ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/40'
                            : c.status === 'prospect'
                            ? 'bg-amber-500/10 text-amber-300 border border-amber-500/40'
                            : 'bg-slate-500/10 text-slate-300 border border-slate-500/40'
                        }`}
                      >
                        {c.status.charAt(0).toUpperCase() + c.status.slice(1)}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 space-y-1.5 text-xs text-slate-400">
                    {c.email && (
                      <p className="truncate">
                        <span className="font-medium text-slate-300">
                          Email:
                        </span>{' '}
                        {c.email}
                      </p>
                    )}
                    {c.phone && (
                      <p>
                        <span className="font-medium text-slate-300">
                          Phone:
                        </span>{' '}
                        {c.phone}
                      </p>
                    )}
                    <p>
                      <span className="font-medium text-slate-300">Terms:</span>{' '}
                      {c.billing_terms || 'Not set'}
                    </p>
                    <p className="text-slate-400">
                      {getCustomerDueText(c)}
                    </p>
                  </div>
                </div>
              </div>

              {c.notes && (
                <p className="mt-3 line-clamp-2 text-xs text-slate-400/80">
                  {c.notes}
                </p>
              )}

              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setEditingCustomer(c);
                    setForm({
                      name: c.name ?? '',
                      company: c.company ?? '',
                      email: c.email ?? '',
                      phone: c.phone ?? '',
                      billing_terms: c.billing_terms ?? 'Net 30',
                      status: c.status ?? 'ACTIVE',
                      notes: c.notes ?? '',
                      balance:
                        c.balance !== null && c.balance !== undefined
                          ? String(c.balance)
                          : '0',
                      last_invoice_date: c.last_invoice_date ?? '',
                    });
                    setIsCreating(true);
                  }}
                  className="text-xs px-3 py-1 rounded-full border border-slate-600 text-slate-200 hover:bg-slate-800"
                >
                  Edit
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* New / Edit customer modal */}
      {isCreating && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100">
                {editingCustomer ? 'Edit customer' : 'New customer'}
              </h3>
              <button
                type="button"
                className="text-xs text-slate-400 hover:text-slate-100"
                onClick={() => setIsCreating(false)}
              >
                Close
              </button>
            </div>

            <form onSubmit={handleCreateCustomer} className="space-y-3 text-sm">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Name *</label>
                <input
                  name="name"
                  value={form.name}
                  onChange={handleInputChange}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Jane Doe"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-400">Company</label>
                <input
                  name="company"
                  value={form.company}
                  onChange={handleInputChange}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Acme Construction LLC"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Email</label>
                  <input
                    name="email"
                    type="email"
                    value={form.email}
                    onChange={handleInputChange}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="client@email.com"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Phone</label>
                  <input
                    name="phone"
                    type="tel"
                    value={form.phone}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        phone: formatPhone(e.target.value),
                      }))
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="(555) 555-5555"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Billing terms</label>
                  <input
                    name="billing_terms"
                    value={form.billing_terms}
                    onChange={handleInputChange}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="Net 30"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Status</label>
                  <select
                    name="status"
                    value={form.status}
                    onChange={handleInputChange}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="active">Active</option>
                    <option value="prospect">Prospect</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-400">Notes</label>
                <textarea
                  name="notes"
                  value={form.notes}
                  onChange={handleInputChange}
                  rows={3}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Key details about this client, preferences, etc."
                />
              </div>

              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreating(false);
                    setEditingCustomer(null);
                  }}
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-medium text-slate-950 shadow hover:bg-emerald-400 disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default function CustomersPage() {
  const { loading: businessLoading, error: businessError } = useAppData();

  return (
    <main className="space-y-4">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
            <p className="text-slate-400 text-sm mt-1">
              Keep track of every client, their details, and their history in one
              premium view.
            </p>
          </div>
        </header>

        {businessError && <div className="text-xs text-rose-300">{businessError}</div>}
        {businessLoading && <div className="text-xs text-slate-400">Loading business…</div>}

        <section className="rounded-2xl bg-slate-900/80 border border-slate-700 p-4 md:p-5">
          <CustomersSection />
        </section>
    </main>
  );
}
