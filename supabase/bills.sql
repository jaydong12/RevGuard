-- Bills table for RevGuard Billing tab

-- Optional: drop existing table while iterating
-- drop table if exists public.bills;

create table if not exists public.bills (
  id bigserial primary key,
  created_at timestamptz not null default now(),

  -- Ownership / scoping
  business_id uuid,

  -- Core bill fields
  vendor text not null,
  description text,
  category text,
  amount numeric(12,2) not null default 0,

  -- Dates (align with frontend naming: issue_date ~ bill_date)
  issue_date date not null default current_date,
  due_date date not null default current_date,

  -- Simple status used in the UI ('OPEN' or 'PAID' in current implementation)
  status text not null default 'OPEN',

  payment_method text,
  notes text,

  -- Recurring configuration
  is_recurring boolean not null default false,
  recurrence_frequency text,        -- 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  reminder_days_before integer default 7
);

-- Backfill safety: ensure business_id exists even if the table pre-dated this file.
alter table if exists public.bills
  add column if not exists business_id uuid;

-- Enable RLS + policies (match frontend filters).
alter table public.bills enable row level security;

drop policy if exists "bills_select_own" on public.bills;
drop policy if exists "bills_insert_own" on public.bills;
drop policy if exists "bills_update_own" on public.bills;
drop policy if exists "bills_delete_own" on public.bills;

create policy "bills_select_own"
  on public.bills
  for select
  using (
    exists (
      select 1
      from public.business b
      where b.id = bills.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "bills_insert_own"
  on public.bills
  for insert
  with check (
    exists (
      select 1
      from public.business b
      where b.id = bills.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "bills_update_own"
  on public.bills
  for update
  using (
    exists (
      select 1
      from public.business b
      where b.id = bills.business_id
        and b.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.business b
      where b.id = bills.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "bills_delete_own"
  on public.bills
  for delete
  using (
    exists (
      select 1
      from public.business b
      where b.id = bills.business_id
        and b.owner_id = auth.uid()
    )
  );


