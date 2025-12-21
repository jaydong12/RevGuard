-- RLS patch: customers + invoices (business-scoped)
-- Goal:
-- - Ensure inserts/updates work when client supplies business_id for the active business
-- - Allow CRUD only when public.business.owner_id = auth.uid()
-- Safe to re-run.

-- -------------------------
-- public.customers
-- -------------------------
alter table if exists public.customers
  add column if not exists business_id uuid;

do $$
begin
  begin
    alter table public.customers
      add constraint customers_business_id_fkey
      foreign key (business_id) references public.business(id)
      on delete cascade;
  exception when duplicate_object then
    null;
  end;
end $$;

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

-- Optional backfill (only if you have a user_id column on customers):
-- If a customer row has NULL business_id, and the user owns exactly one business,
-- attach the row to that business.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'customers'
      and column_name = 'user_id'
  ) then
    update public.customers c
    set business_id = (
      select b.id from public.business b
      where b.owner_id = c.user_id
      order by b.created_at asc
      limit 1
    )
    where c.business_id is null
      and c.user_id is not null;
  end if;
end $$;

-- -------------------------
-- public.invoices
-- -------------------------
alter table if exists public.invoices
  add column if not exists business_id uuid;

do $$
begin
  begin
    alter table public.invoices
      add constraint invoices_business_id_fkey
      foreign key (business_id) references public.business(id)
      on delete cascade;
  exception when duplicate_object then
    null;
  end;
end $$;

alter table if exists public.invoices enable row level security;

drop policy if exists "invoices_select_own" on public.invoices;
drop policy if exists "invoices_insert_own" on public.invoices;
drop policy if exists "invoices_update_own" on public.invoices;
drop policy if exists "invoices_delete_own" on public.invoices;

create policy "invoices_select_own"
  on public.invoices
  for select
  using (
    exists (
      select 1
      from public.business b
      where b.id = invoices.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "invoices_insert_own"
  on public.invoices
  for insert
  with check (
    exists (
      select 1
      from public.business b
      where b.id = invoices.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "invoices_update_own"
  on public.invoices
  for update
  using (
    exists (
      select 1
      from public.business b
      where b.id = invoices.business_id
        and b.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.business b
      where b.id = invoices.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "invoices_delete_own"
  on public.invoices
  for delete
  using (
    exists (
      select 1
      from public.business b
      where b.id = invoices.business_id
        and b.owner_id = auth.uid()
    )
  );

-- Optional backfill (only if you have a user_id column on invoices):
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invoices'
      and column_name = 'user_id'
  ) then
    update public.invoices i
    set business_id = (
      select b.id from public.business b
      where b.owner_id = i.user_id
      order by b.created_at asc
      limit 1
    )
    where i.business_id is null
      and i.user_id is not null;
  end if;
end $$;


