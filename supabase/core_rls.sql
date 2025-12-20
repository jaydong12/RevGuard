-- Core RLS policies for RevGuard tables.
-- Rule: rows are accessible only if their business belongs to the authed user:
--   exists (select 1 from public.business b where b.id = <row>.business_id and b.owner_id = auth.uid())
--
-- Apply this after your tables exist. It's written to be safe to re-run.

-- -------------------------
-- public.business (aka "businesses")
-- -------------------------
alter table if exists public.business
  add column if not exists owner_id uuid;

do $$
begin
  begin
    alter table public.business
      add constraint business_owner_id_fkey
      foreign key (owner_id) references auth.users(id)
      on delete set null;
  exception when duplicate_object then
    null;
  end;
end $$;

alter table if exists public.business enable row level security;

drop policy if exists "business_select_own" on public.business;
drop policy if exists "business_insert_own" on public.business;
drop policy if exists "business_update_own" on public.business;
drop policy if exists "business_delete_own" on public.business;

create policy "business_select_own"
  on public.business
  for select
  using (auth.uid() = owner_id);

create policy "business_insert_own"
  on public.business
  for insert
  with check (auth.uid() = owner_id);

create policy "business_update_own"
  on public.business
  for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "business_delete_own"
  on public.business
  for delete
  using (auth.uid() = owner_id);

-- -------------------------
-- public.transactions
-- -------------------------
alter table if exists public.transactions
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table if exists public.transactions enable row level security;

drop policy if exists "transactions_select_own" on public.transactions;
drop policy if exists "transactions_insert_own" on public.transactions;
drop policy if exists "transactions_update_own" on public.transactions;
drop policy if exists "transactions_delete_own" on public.transactions;

create policy "transactions_select_own"
  on public.transactions
  for select
  using (
    exists (
      select 1
      from public.business b
      where b.id = transactions.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "transactions_insert_own"
  on public.transactions
  for insert
  with check (
    exists (
      select 1
      from public.business b
      where b.id = transactions.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "transactions_update_own"
  on public.transactions
  for update
  using (
    exists (
      select 1
      from public.business b
      where b.id = transactions.business_id
        and b.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.business b
      where b.id = transactions.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "transactions_delete_own"
  on public.transactions
  for delete
  using (
    exists (
      select 1
      from public.business b
      where b.id = transactions.business_id
        and b.owner_id = auth.uid()
    )
  );

-- -------------------------
-- public.customers
-- -------------------------
create table if not exists public.customers (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete cascade,
  business_id uuid references public.business(id) on delete cascade,
  name text not null,
  company text,
  email text,
  phone text,
  billing_terms text,
  status text,
  notes text,
  balance numeric(12,2) not null default 0,
  last_invoice_date date
);

alter table if exists public.customers
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table if exists public.customers
  add column if not exists business_id uuid references public.business(id) on delete cascade;

alter table if exists public.customers enable row level security;

drop policy if exists "customers_select_own" on public.customers;
drop policy if exists "customers_insert_own" on public.customers;
drop policy if exists "customers_update_own" on public.customers;
drop policy if exists "customers_delete_own" on public.customers;

create policy "customers_select_own"
  on public.customers
  for select
  using (
    exists (
      select 1
      from public.business b
      where b.id = customers.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "customers_insert_own"
  on public.customers
  for insert
  with check (
    exists (
      select 1
      from public.business b
      where b.id = customers.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "customers_update_own"
  on public.customers
  for update
  using (
    exists (
      select 1
      from public.business b
      where b.id = customers.business_id
        and b.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.business b
      where b.id = customers.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "customers_delete_own"
  on public.customers
  for delete
  using (
    exists (
      select 1
      from public.business b
      where b.id = customers.business_id
        and b.owner_id = auth.uid()
    )
  );


