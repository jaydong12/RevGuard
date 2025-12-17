-- Bills table for RevGuard Billing tab

-- Optional: drop existing table while iterating
-- drop table if exists public.bills;

create table if not exists public.bills (
  id bigserial primary key,
  created_at timestamptz not null default now(),

  -- Link to businesses if you have that table; keep nullable for demo data
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

-- Disable RLS for now so dev/testing isn't blocked
alter table public.bills disable row level security;


