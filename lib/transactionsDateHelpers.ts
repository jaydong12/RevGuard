'use client';

import type { DateRangePreset } from '../components/TransactionFilters';

export function computeDateRange(
  preset: DateRangePreset,
  from?: string,
  to?: string
) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();

  function toISODate(d: Date) {
    return d.toISOString().split('T')[0];
  }

  if (preset === 'custom' && from && to) {
    return { from, to };
  }

  if (preset === 'this-month') {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);
    return { from: toISODate(start), to: toISODate(end) };
  }
  if (preset === 'last-month') {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    return { from: toISODate(start), to: toISODate(end) };
  }
  if (preset === 'this-year') {
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    return { from: toISODate(start), to: toISODate(end) };
  }
  if (preset === 'last-year') {
    const start = new Date(year - 1, 0, 1);
    const end = new Date(year - 1, 11, 31);
    return { from: toISODate(start), to: toISODate(end) };
  }

  // Fallback: everything up to today
  return { from: '2000-01-01', to: toISODate(today) };
}


