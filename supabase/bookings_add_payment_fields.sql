-- Add booking payment fields so payment status lives on bookings (not invoices).
-- Idempotent and safe to re-run.

alter table if exists public.bookings
  add column if not exists is_paid boolean not null default false;

alter table if exists public.bookings
  add column if not exists paid_at timestamptz;

alter table if exists public.bookings
  add column if not exists payment_status text not null default 'unpaid';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bookings_payment_status_check'
  ) then
    alter table public.bookings
      add constraint bookings_payment_status_check
      check (payment_status in ('unpaid','paid'));
  end if;
end $$;


