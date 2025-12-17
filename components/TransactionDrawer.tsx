'use client';

import React, { useEffect, useState } from 'react';
import type {
  Transaction,
  TransactionKind,
  TransactionStatus,
} from '../types/transactions';

interface Props {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: Transaction | null;
  onClose: () => void;
  onSubmit: (values: Omit<Transaction, 'id'>, existingId?: string) => Promise<void>;
}

type FormErrors = Partial<Record<keyof Omit<Transaction, 'id'>, string>>;

const EMPTY_FORM: Omit<Transaction, 'id'> = {
  date: '',
  description: '',
  category: null,
  amount: 0,
  type: 'expense',
  account: '',
  status: 'pending',
  source: 'manual',
  notes: '',
  user_id: 'demo-user',
  business_id: null,
  created_at: null,
  updated_at: null,
};

export function TransactionDrawer({
  open,
  mode,
  initial,
  onClose,
  onSubmit,
}: Props) {
  const [values, setValues] = useState<Omit<Transaction, 'id'>>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setValues(EMPTY_FORM);
      setErrors({});
      setSubmitting(false);
      return;
    }

    if (mode === 'edit' && initial) {
      const cloned: Omit<Transaction, 'id'> = {
        date: initial.date ?? '',
        description: initial.description ?? '',
        category: initial.category ?? null,
        amount: initial.amount ?? 0,
        type: initial.type ?? 'expense',
        account: initial.account ?? '',
        status: initial.status ?? 'pending',
        source: initial.source ?? 'manual',
        notes: initial.notes ?? '',
        user_id: initial.user_id,
        business_id: initial.business_id ?? null,
        created_at: initial.created_at ?? null,
        updated_at: initial.updated_at ?? null,
      };
      setValues(cloned);
      setErrors({});
    } else {
      setValues(EMPTY_FORM);
      setErrors({});
    }
  }, [open, mode, initial]);

  function handleChange<K extends keyof Omit<Transaction, 'id'>>(
    key: K,
    value: Omit<Transaction, 'id'>[K]
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function validate(): boolean {
    const next: FormErrors = {};
    if (!values.date) next.date = 'Date is required';
    if (!values.type) next.type = 'Type is required';
    if (!values.description) next.description = 'Description is required';
    if (values.amount === null || Number.isNaN(Number(values.amount))) {
      next.amount = 'Amount is required';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      await onSubmit(
        {
          ...values,
          amount: Number(values.amount),
        },
        mode === 'edit' && initial ? initial.id : undefined
      );
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="w-full max-w-md bg-slate-950 border-l border-slate-800 shadow-xl p-5 text-xs flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              {mode === 'create' ? 'New transaction' : 'Edit transaction'}
            </h2>
            <p className="text-[11px] text-slate-400">
              Fill in the key details. You can always tweak categories later.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-100"
          >
            ✕
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-3 flex-1 overflow-y-auto pr-1"
        >
          <div className="space-y-1">
            <label className="block text-[11px] text-slate-300">
              Date<span className="text-rose-400">*</span>
            </label>
            <input
              type="date"
              value={values.date}
              onChange={(e) => handleChange('date', e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px]"
            />
            {errors.date && (
              <p className="text-[10px] text-rose-400">{errors.date}</p>
            )}
          </div>

          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <label className="block text-[11px] text-slate-300">
                Type<span className="text-rose-400">*</span>
              </label>
              <select
                value={values.type ?? 'expense'}
                onChange={(e) =>
                  handleChange('type', e.target.value as TransactionKind)
                }
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px]"
              >
                <option value="income">Income</option>
                <option value="expense">Expense</option>
                <option value="transfer">Transfer</option>
                <option value="asset">Asset</option>
                <option value="liability">Liability</option>
              </select>
              {errors.type && (
                <p className="text-[10px] text-rose-400">{errors.type}</p>
              )}
            </div>
            <div className="flex-1 space-y-1">
              <label className="block text-[11px] text-slate-300">
                Status
              </label>
              <select
                value={values.status ?? 'pending'}
                onChange={(e) =>
                  handleChange('status', e.target.value as TransactionStatus)
                }
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px]"
              >
                <option value="cleared">Cleared</option>
                <option value="pending">Pending</option>
                <option value="reconciled">Reconciled</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] text-slate-300">
              Description<span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={values.description}
              onChange={(e) => handleChange('description', e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px]"
              placeholder="What was this for?"
            />
            {errors.description && (
              <p className="text-[10px] text-rose-400">{errors.description}</p>
            )}
          </div>

          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <label className="block text-[11px] text-slate-300">Category</label>
              <input
                type="text"
                value={values.category ?? ''}
                onChange={(e) => handleChange('category', e.target.value || null)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px]"
                placeholder="e.g. Software, Rent, Payroll"
              />
            </div>
            <div className="flex-1 space-y-1">
              <label className="block text-[11px] text-slate-300">Account</label>
              <input
                type="text"
                value={values.account ?? ''}
                onChange={(e) => handleChange('account', e.target.value || null)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px]"
                placeholder="e.g. Checking, Credit Card"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] text-slate-300">
              Amount<span className="text-rose-400">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              value={values.amount}
              onChange={(e) =>
                handleChange('amount', Number(e.target.value || '0'))
              }
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px]"
              placeholder="Use positive numbers; type controls direction"
            />
            {errors.amount && (
              <p className="text-[10px] text-rose-400">{errors.amount}</p>
            )}
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] text-slate-300">Notes</label>
            <textarea
              value={values.notes ?? ''}
              onChange={(e) => handleChange('notes', e.target.value || null)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] min-h-[60px]"
              placeholder="Optional extra context for future you."
            />
          </div>

          {mode === 'edit' && initial?.source && (
            <div className="text-[11px] text-slate-500">
              Source:{' '}
              <span className="uppercase tracking-wide">
                {initial.source}
              </span>
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-200 text-[11px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 text-[11px] font-semibold hover:bg-emerald-400 disabled:bg-slate-700"
            >
              {submitting
                ? mode === 'create'
                  ? 'Creating…'
                  : 'Saving…'
                : mode === 'create'
                ? 'Create transaction'
                : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


