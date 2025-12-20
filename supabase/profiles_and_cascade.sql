-- Profiles table + cascade deletes for account deletion
--
-- 1) public.profiles: user-owned profile fields (1 row per auth.user)
-- 2) Ensure deleting an auth user cascades:
--    auth.users -> public.business (owner_id) -> child tables (business_id)
--
-- Safe to re-run.

create extension if not exists pgcrypto;

-- -------------------------
-- public.profiles
-- -------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  city text,
  country text,
  updated_at timestamptz not null default now()
);

-- If the table already existed, ensure new columns exist (safe to re-run).
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists updated_at timestamptz default now();

-- Keep updated_at fresh on updates (safe to re-run).
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_delete_own" on public.profiles;

create policy "profiles_select_own"
  on public.profiles
  for select
  using (auth.uid() = id);

create policy "profiles_insert_own"
  on public.profiles
  for insert
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Optional: allow users to delete their own profile row (auth user deletion will cascade anyway).
create policy "profiles_delete_own"
  on public.profiles
  for delete
  using (auth.uid() = id);

-- -------------------------
-- Cascade delete: auth.users -> public.business(owner_id)
-- -------------------------
alter table if exists public.business
  drop constraint if exists business_owner_id_fkey;

do $$
begin
  if to_regclass('public.business') is not null then
    begin
      alter table public.business
        add constraint business_owner_id_fkey
        foreign key (owner_id) references auth.users(id)
        on delete cascade;
    exception when duplicate_object then
      null;
    end;
  end if;
end $$;

-- -------------------------
-- Cascade delete: public.business(id) -> child tables(business_id)
-- -------------------------
do $$
begin
  -- transactions.business_id
  if to_regclass('public.transactions') is not null then
    alter table public.transactions drop constraint if exists transactions_business_id_fkey;
    begin
      alter table public.transactions
        add constraint transactions_business_id_fkey
        foreign key (business_id) references public.business(id)
        on delete cascade;
    exception when duplicate_object then null;
    end;
  end if;

  -- customers.business_id
  if to_regclass('public.customers') is not null then
    alter table public.customers drop constraint if exists customers_business_id_fkey;
    begin
      alter table public.customers
        add constraint customers_business_id_fkey
        foreign key (business_id) references public.business(id)
        on delete cascade;
    exception when duplicate_object then null;
    end;
  end if;

  -- bills.business_id
  if to_regclass('public.bills') is not null then
    alter table public.bills drop constraint if exists bills_business_id_fkey;
    begin
      alter table public.bills
        add constraint bills_business_id_fkey
        foreign key (business_id) references public.business(id)
        on delete cascade;
    exception when duplicate_object then null;
    end;
  end if;

  -- invoices.business_id
  if to_regclass('public.invoices') is not null then
    alter table public.invoices drop constraint if exists invoices_business_id_fkey;
    begin
      alter table public.invoices
        add constraint invoices_business_id_fkey
        foreign key (business_id) references public.business(id)
        on delete cascade;
    exception when duplicate_object then null;
    end;
  end if;

  -- invoice_items.invoice_id (invoice deletion cascades; ensure it if present)
  if to_regclass('public.invoice_items') is not null then
    alter table public.invoice_items drop constraint if exists invoice_items_invoice_id_fkey;
    begin
      alter table public.invoice_items
        add constraint invoice_items_invoice_id_fkey
        foreign key (invoice_id) references public.invoices(id)
        on delete cascade;
    exception when duplicate_object then null;
    end;
  end if;

  -- ai tables (best-effort)
  if to_regclass('public.ai_business_memory') is not null then
    alter table public.ai_business_memory drop constraint if exists ai_business_memory_business_id_fkey;
    begin
      alter table public.ai_business_memory
        add constraint ai_business_memory_business_id_fkey
        foreign key (business_id) references public.business(id)
        on delete cascade;
    exception when duplicate_object then null;
    end;
  end if;

  if to_regclass('public.ai_advice_log') is not null then
    alter table public.ai_advice_log drop constraint if exists ai_advice_log_business_id_fkey;
    begin
      alter table public.ai_advice_log
        add constraint ai_advice_log_business_id_fkey
        foreign key (business_id) references public.business(id)
        on delete cascade;
    exception when duplicate_object then null;
    end;
  end if;

  if to_regclass('public.ai_recommendations') is not null then
    alter table public.ai_recommendations drop constraint if exists ai_recommendations_business_id_fkey;
    begin
      alter table public.ai_recommendations
        add constraint ai_recommendations_business_id_fkey
        foreign key (business_id) references public.business(id)
        on delete cascade;
    exception when duplicate_object then null;
    end;
  end if;

  if to_regclass('public.ai_outcome_snapshots') is not null then
    alter table public.ai_outcome_snapshots drop constraint if exists ai_outcome_snapshots_business_id_fkey;
    begin
      alter table public.ai_outcome_snapshots
        add constraint ai_outcome_snapshots_business_id_fkey
        foreign key (business_id) references public.business(id)
        on delete cascade;
    exception when duplicate_object then null;
    end;
  end if;

  if to_regclass('public.ai_insight_runs') is not null then
    alter table public.ai_insight_runs drop constraint if exists ai_insight_runs_business_id_fkey;
    begin
      alter table public.ai_insight_runs
        add constraint ai_insight_runs_business_id_fkey
        foreign key (business_id) references public.business(id)
        on delete cascade;
    exception when duplicate_object then null;
    end;
  end if;

  if to_regclass('public.business_settings') is not null then
    alter table public.business_settings drop constraint if exists business_settings_business_id_fkey;
    begin
      alter table public.business_settings
        add constraint business_settings_business_id_fkey
        foreign key (business_id) references public.business(id)
        on delete cascade;
    exception when duplicate_object then null;
    end;
  end if;

  -- audit_logs.target_business_id (if you prefer to retain audit logs, change to ON DELETE SET NULL)
  if to_regclass('public.audit_logs') is not null then
    alter table public.audit_logs drop constraint if exists audit_logs_target_business_id_fkey;
    begin
      alter table public.audit_logs
        add constraint audit_logs_target_business_id_fkey
        foreign key (target_business_id) references public.business(id)
        on delete cascade;
    exception when duplicate_object then null;
    end;
  end if;
end $$;


