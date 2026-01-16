-- Employee clock hardening (constraints + audit + invariants)
-- Safe to re-run.

-- 1) profiles.role enum must support owner/manager/employee.
do $$
begin
  if exists (select 1 from pg_type where typname = 'profile_role') then
    begin
      alter type public.profile_role add value if not exists 'manager';
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- 2) workers must have (business_id, user_id unique, email).
alter table public.workers
  add column if not exists email text;
alter table public.workers
  add column if not exists user_id uuid references auth.users(id) on delete set null;

-- Unique: one auth user maps to at most one worker (across all businesses).
create unique index if not exists workers_user_id_unique
  on public.workers (user_id)
  where user_id is not null;

-- Unique per-business email (helps safe first-login linking).
create unique index if not exists workers_business_email_unique
  on public.workers (business_id, lower(email))
  where email is not null;

-- 3) one open shift per worker (partial unique) - ensure exists.
create unique index if not exists time_entries_one_open_per_worker
  on public.time_entries (business_id, worker_id)
  where clock_out_at is null;

-- 4) invariant: time_entries.business_id must match workers.business_id for the referenced worker_id.
create or replace function public.enforce_time_entry_business_matches_worker()
returns trigger
language plpgsql
as $fn$
declare
  w_business uuid;
begin
  select w.business_id into w_business
  from public.workers w
  where w.id = new.worker_id;

  if w_business is null then
    raise exception 'Invalid worker_id';
  end if;

  if new.business_id <> w_business then
    raise exception 'business_id must match worker.business_id';
  end if;

  return new;
end
$fn$;

drop trigger if exists enforce_time_entry_business_matches_worker_trg on public.time_entries;
create trigger enforce_time_entry_business_matches_worker_trg
  before insert or update on public.time_entries
  for each row execute function public.enforce_time_entry_business_matches_worker();

-- 5) audit log for clock in/out
create table if not exists public.time_entry_audit (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.business(id) on delete cascade,
  worker_id bigint not null references public.workers(id) on delete cascade,
  action text not null check (action in ('clock_in','clock_out')),
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists time_entry_audit_user_created_idx
  on public.time_entry_audit (user_id, created_at desc);

alter table public.time_entry_audit enable row level security;
drop policy if exists "time_entry_audit_select_own" on public.time_entry_audit;
drop policy if exists "time_entry_audit_select_business_owner_or_manager" on public.time_entry_audit;

-- Employee can read own audit rows.
create policy "time_entry_audit_select_own"
  on public.time_entry_audit
  for select
  using (auth.uid() = user_id);

-- Owner/manager can read audit rows for businesses they belong to.
create policy "time_entry_audit_select_business_owner_or_manager"
  on public.time_entry_audit
  for select
  using (
    exists (
      select 1
      from public.business b
      where b.id = time_entry_audit.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = time_entry_audit.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager')
    )
  );

notify pgrst, 'reload schema';


