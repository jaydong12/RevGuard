-- Stripe Financial Connections (Phase 1 MVP)
-- Secure, server-driven bank linking + transaction import.
-- Safe to re-run.
--
-- NOTE:
-- - Client must NOT be able to insert/update bank connections/accounts/transactions/sync runs.
-- - Client may manage categories + merchant rules.
-- - Transaction categorization updates happen via server endpoint (service role).

create extension if not exists pgcrypto;

-- -------------------------
-- bank_connections (stripe_fc)
-- -------------------------
create table if not exists public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  provider text not null default 'stripe_fc',
  provider_item_id text not null,
  status text not null default 'active',
  last_sync_at timestamptz,
  last_cursor text,
  created_at timestamptz not null default now()
);

create unique index if not exists bank_connections_business_provider_item_unique
  on public.bank_connections (business_id, provider, provider_item_id);

alter table public.bank_connections enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select polname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'bank_connections'
  loop
    execute format('drop policy if exists %I on public.bank_connections', pol.polname);
  end loop;
end $$;

create policy "bank_connections_select_members"
  on public.bank_connections
  for select
  using (
    exists (select 1 from public.business b where b.id = bank_connections.business_id and b.owner_id = auth.uid())
    or exists (select 1 from public.business_members bm where bm.business_id = bank_connections.business_id and bm.user_id = auth.uid())
  );

-- No INSERT/UPDATE/DELETE policies for clients. Server uses service role.

-- -------------------------
-- bank_accounts: extend existing table for stripe_fc
-- -------------------------
alter table public.bank_accounts
  add column if not exists bank_connection_id uuid references public.bank_connections(id) on delete cascade,
  add column if not exists last_sync_at timestamptz,
  add column if not exists last_cursor text,
  add column if not exists status text not null default 'active';

alter table public.bank_accounts enable row level security;

-- Replace policies to make bank_accounts read-only for members.
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

-- No INSERT/UPDATE/DELETE policies for clients. Server uses service role.

-- -------------------------
-- tx_categories (per business)
-- -------------------------
create table if not exists public.tx_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists tx_categories_business_name_unique
  on public.tx_categories (business_id, lower(name));

alter table public.tx_categories enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select polname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tx_categories'
  loop
    execute format('drop policy if exists %I on public.tx_categories', pol.polname);
  end loop;
end $$;

create policy "tx_categories_select_members"
  on public.tx_categories
  for select
  using (
    exists (select 1 from public.business b where b.id = tx_categories.business_id and b.owner_id = auth.uid())
    or exists (select 1 from public.business_members bm where bm.business_id = tx_categories.business_id and bm.user_id = auth.uid())
  );

create policy "tx_categories_write_owner_manager_admin"
  on public.tx_categories
  for all
  using (
    exists (select 1 from public.business b where b.id = tx_categories.business_id and b.owner_id = auth.uid())
    or exists (
      select 1 from public.business_members bm
      where bm.business_id = tx_categories.business_id and bm.user_id = auth.uid()
        and bm.role in ('owner','manager','admin')
    )
  )
  with check (
    exists (select 1 from public.business b where b.id = tx_categories.business_id and b.owner_id = auth.uid())
    or exists (
      select 1 from public.business_members bm
      where bm.business_id = tx_categories.business_id and bm.user_id = auth.uid()
        and bm.role in ('owner','manager','admin')
    )
  );

-- -------------------------
-- merchant_rules: extend existing table to support match types (equals/contains/regex)
-- -------------------------
alter table public.merchant_rules
  alter column category_id drop not null,
  add column if not exists match_type text not null default 'contains',
  add column if not exists pattern text,
  add column if not exists tx_category_id uuid references public.tx_categories(id) on delete restrict;

-- Backfill pattern/tx_category_id for older rows using merchant_key/category_id when present.
update public.merchant_rules
set pattern = coalesce(pattern, merchant_key)
where pattern is null;

-- RLS: keep existing policies but ensure members can manage (already present in bank_feed_v1).
-- NOTE: merchant_rules in MVP are managed by members (owner/manager/admin); updates via client OK.

-- -------------------------
-- tx_category_overrides (audit)
-- -------------------------
create table if not exists public.tx_category_overrides (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  bank_transaction_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  merchant_name text,
  old_category_id uuid,
  new_category_id uuid,
  apply_future boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists tx_category_overrides_business_created_idx
  on public.tx_category_overrides (business_id, created_at desc);

alter table public.tx_category_overrides enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select polname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tx_category_overrides'
  loop
    execute format('drop policy if exists %I on public.tx_category_overrides', pol.polname);
  end loop;
end $$;

create policy "tx_category_overrides_select_members"
  on public.tx_category_overrides
  for select
  using (
    exists (select 1 from public.business b where b.id = tx_category_overrides.business_id and b.owner_id = auth.uid())
    or exists (select 1 from public.business_members bm where bm.business_id = tx_category_overrides.business_id and bm.user_id = auth.uid())
  );

-- No INSERT policy for client; server writes audit via service role.

-- -------------------------
-- bank_sync_runs (audit/log)
-- -------------------------
create table if not exists public.bank_sync_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  bank_connection_id uuid references public.bank_connections(id) on delete set null,
  status text not null default 'started',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  inserted_count integer not null default 0,
  error_message text
);

create index if not exists bank_sync_runs_business_started_idx
  on public.bank_sync_runs (business_id, started_at desc);

alter table public.bank_sync_runs enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select polname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'bank_sync_runs'
  loop
    execute format('drop policy if exists %I on public.bank_sync_runs', pol.polname);
  end loop;
end $$;

create policy "bank_sync_runs_select_members"
  on public.bank_sync_runs
  for select
  using (
    exists (select 1 from public.business b where b.id = bank_sync_runs.business_id and b.owner_id = auth.uid())
    or exists (select 1 from public.business_members bm where bm.business_id = bank_sync_runs.business_id and bm.user_id = auth.uid())
  );

-- No INSERT/UPDATE/DELETE policies for clients. Server uses service role.

-- -------------------------
-- bank_transactions: extend existing table for stripe_fc fields and lock down writes
-- -------------------------
alter table public.bank_transactions
  add column if not exists provider_tx_id text,
  add column if not exists amount_cents integer,
  add column if not exists direction text,
  add column if not exists tx_category_id uuid references public.tx_categories(id) on delete set null;

-- Ensure idempotency is possible for stripe_fc as well.
create unique index if not exists bank_transactions_business_provider_txid_unique
  on public.bank_transactions (business_id, provider, provider_tx_id)
  where provider_tx_id is not null;

-- Replace policies to make bank_transactions read-only for members (categorization changes happen via API).
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

-- No INSERT/UPDATE/DELETE policies for clients. Server uses service role.

notify pgrst, 'reload schema';



