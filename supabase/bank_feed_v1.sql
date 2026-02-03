-- Bank feed Phase 1 (MVP)
-- Tables:
-- - bank_accounts
-- - categories
-- - merchant_rules
-- - bank_transactions
-- Multi-tenant by business_id with RLS.
-- Safe to re-run.

create extension if not exists pgcrypto;

-- -------------------------
-- categories (per business)
-- -------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists categories_business_name_unique
  on public.categories (business_id, lower(name));

alter table public.categories enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select polname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'categories'
  loop
    execute format('drop policy if exists %I on public.categories', pol.polname);
  end loop;
end $$;

create policy "categories_select_members"
  on public.categories
  for select
  using (
    exists (select 1 from public.business b where b.id = categories.business_id and b.owner_id = auth.uid())
    or exists (select 1 from public.business_members bm where bm.business_id = categories.business_id and bm.user_id = auth.uid())
  );

create policy "categories_write_owner_manager_admin"
  on public.categories
  for all
  using (
    exists (select 1 from public.business b where b.id = categories.business_id and b.owner_id = auth.uid())
    or exists (
      select 1 from public.business_members bm
      where bm.business_id = categories.business_id and bm.user_id = auth.uid()
        and bm.role in ('owner','manager','admin')
    )
  )
  with check (
    exists (select 1 from public.business b where b.id = categories.business_id and b.owner_id = auth.uid())
    or exists (
      select 1 from public.business_members bm
      where bm.business_id = categories.business_id and bm.user_id = auth.uid()
        and bm.role in ('owner','manager','admin')
    )
  );

-- -------------------------
-- bank_accounts
-- -------------------------
create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  provider text not null default 'mock',
  provider_account_id text not null,
  name text not null default 'Checking',
  mask text,
  currency text not null default 'USD',
  created_at timestamptz not null default now()
);

create unique index if not exists bank_accounts_business_provider_account_unique
  on public.bank_accounts (business_id, provider, provider_account_id);

alter table public.bank_accounts enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select polname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'bank_accounts'
  loop
    execute format('drop policy if exists %I on public.bank_accounts', pol.polname);
  end loop;
end $$;

create policy "bank_accounts_select_members"
  on public.bank_accounts
  for select
  using (
    exists (select 1 from public.business b where b.id = bank_accounts.business_id and b.owner_id = auth.uid())
    or exists (select 1 from public.business_members bm where bm.business_id = bank_accounts.business_id and bm.user_id = auth.uid())
  );

create policy "bank_accounts_write_owner_manager_admin"
  on public.bank_accounts
  for all
  using (
    exists (select 1 from public.business b where b.id = bank_accounts.business_id and b.owner_id = auth.uid())
    or exists (
      select 1 from public.business_members bm
      where bm.business_id = bank_accounts.business_id and bm.user_id = auth.uid()
        and bm.role in ('owner','manager','admin')
    )
  )
  with check (
    exists (select 1 from public.business b where b.id = bank_accounts.business_id and b.owner_id = auth.uid())
    or exists (
      select 1 from public.business_members bm
      where bm.business_id = bank_accounts.business_id and bm.user_id = auth.uid()
        and bm.role in ('owner','manager','admin')
    )
  );

-- -------------------------
-- merchant_rules
-- -------------------------
create table if not exists public.merchant_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  merchant_key text not null,
  category_id uuid not null references public.categories(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists merchant_rules_business_key_unique
  on public.merchant_rules (business_id, merchant_key);

alter table public.merchant_rules enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select polname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'merchant_rules'
  loop
    execute format('drop policy if exists %I on public.merchant_rules', pol.polname);
  end loop;
end $$;

create policy "merchant_rules_select_members"
  on public.merchant_rules
  for select
  using (
    exists (select 1 from public.business b where b.id = merchant_rules.business_id and b.owner_id = auth.uid())
    or exists (select 1 from public.business_members bm where bm.business_id = merchant_rules.business_id and bm.user_id = auth.uid())
  );

create policy "merchant_rules_write_owner_manager_admin"
  on public.merchant_rules
  for all
  using (
    exists (select 1 from public.business b where b.id = merchant_rules.business_id and b.owner_id = auth.uid())
    or exists (
      select 1 from public.business_members bm
      where bm.business_id = merchant_rules.business_id and bm.user_id = auth.uid()
        and bm.role in ('owner','manager','admin')
    )
  )
  with check (
    exists (select 1 from public.business b where b.id = merchant_rules.business_id and b.owner_id = auth.uid())
    or exists (
      select 1 from public.business_members bm
      where bm.business_id = merchant_rules.business_id and bm.user_id = auth.uid()
        and bm.role in ('owner','manager','admin')
    )
  );

-- -------------------------
-- bank_transactions
-- -------------------------
create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  bank_account_id uuid not null references public.bank_accounts(id) on delete cascade,
  provider text not null default 'mock',
  provider_transaction_id text not null,
  posted_at date not null,
  amount numeric(14,2) not null,
  currency text not null default 'USD',
  merchant_name text,
  description text,
  category_id uuid references public.categories(id) on delete set null,
  category_source text not null default 'default',
  confidence numeric(4,3) not null default 0.2,
  needs_review boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists bank_transactions_business_provider_tx_unique
  on public.bank_transactions (business_id, provider, provider_transaction_id);

create index if not exists bank_transactions_business_posted_idx
  on public.bank_transactions (business_id, posted_at desc);

create index if not exists bank_transactions_business_needs_review_idx
  on public.bank_transactions (business_id, needs_review, posted_at desc);

alter table public.bank_transactions enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select polname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'bank_transactions'
  loop
    execute format('drop policy if exists %I on public.bank_transactions', pol.polname);
  end loop;
end $$;

create policy "bank_transactions_select_members"
  on public.bank_transactions
  for select
  using (
    exists (select 1 from public.business b where b.id = bank_transactions.business_id and b.owner_id = auth.uid())
    or exists (select 1 from public.business_members bm where bm.business_id = bank_transactions.business_id and bm.user_id = auth.uid())
  );

-- Users can update transactions for their business to categorize/mark review.
create policy "bank_transactions_update_members"
  on public.bank_transactions
  for update
  using (
    exists (select 1 from public.business b where b.id = bank_transactions.business_id and b.owner_id = auth.uid())
    or exists (select 1 from public.business_members bm where bm.business_id = bank_transactions.business_id and bm.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.business b where b.id = bank_transactions.business_id and b.owner_id = auth.uid())
    or exists (select 1 from public.business_members bm where bm.business_id = bank_transactions.business_id and bm.user_id = auth.uid())
  );

-- Inserts are expected from backend importer; allow owner/manager/admin as well.
create policy "bank_transactions_insert_owner_manager_admin"
  on public.bank_transactions
  for insert
  with check (
    exists (select 1 from public.business b where b.id = bank_transactions.business_id and b.owner_id = auth.uid())
    or exists (
      select 1 from public.business_members bm
      where bm.business_id = bank_transactions.business_id and bm.user_id = auth.uid()
        and bm.role in ('owner','manager','admin')
    )
  );

notify pgrst, 'reload schema';


