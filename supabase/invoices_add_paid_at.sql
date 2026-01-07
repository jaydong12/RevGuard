-- Add invoices.paid_at for "Mark Paid" UX.
-- Idempotent and safe to re-run.

alter table if exists public.invoices
  add column if not exists paid_at timestamptz;


