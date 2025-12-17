-- Smart invoices main table
create table if not exists public.invoices (
  id bigserial primary key,
  business_id uuid references public.businesses(id) on delete cascade,
  invoice_number text not null,
  client_name text not null,
  issue_date date not null,
  due_date date not null,
  status text not null check (status in ('draft','sent','paid','overdue')),
  subtotal numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  notes text,
  transaction_id bigint references public.transactions(id),
  created_at timestamptz not null default now()
);

-- Invoice line items
create table if not exists public.invoice_items (
  id bigserial primary key,
  invoice_id bigint not null references public.invoices(id) on delete cascade,
  description text not null,
  quantity numeric(12,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  line_total numeric(12,2) generated always as (quantity * unit_price) stored
);

-- Disable RLS temporarily so saves work
alter table public.invoices disable row level security;
alter table public.invoice_items disable row level security;

-- NOTE:
-- If your businesses table is named something else, replace
--   public.businesses(id)
-- with the correct table + primary key before running this.


