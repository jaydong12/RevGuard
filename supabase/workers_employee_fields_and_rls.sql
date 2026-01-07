-- Workers hardening:
-- - add employee/contact/pay fields
-- - tighten RLS: owner/manager full manage; employee SELECT only self via workers.user_id = auth.uid()
-- Safe to re-run.

-- Columns
alter table public.workers
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists title text,
  add column if not exists pay_type text,
  add column if not exists overtime_enabled boolean not null default false,
  add column if not exists notes text;

-- Ensure user_id exists (self clock-in identity).
alter table public.workers
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists workers_business_user_idx
  on public.workers (business_id, user_id);

alter table public.workers enable row level security;

-- Drop known prior policies (to avoid overlap/ambiguity).
drop policy if exists "workers_select_own" on public.workers;
drop policy if exists "workers_select_owner_or_employee" on public.workers;
drop policy if exists "workers_select_members" on public.workers;
drop policy if exists "workers_insert_own" on public.workers;
drop policy if exists "workers_insert_owner_or_manager" on public.workers;
drop policy if exists "workers_update_own" on public.workers;
drop policy if exists "workers_update_owner_or_manager" on public.workers;
drop policy if exists "workers_delete_own" on public.workers;
drop policy if exists "workers_delete_owner_or_manager" on public.workers;

-- SELECT:
-- - owner/manager can read all workers in business
-- - employee can read ONLY their own worker row (workers.user_id = auth.uid())
create policy "workers_select_owner_manager_or_self"
  on public.workers
  for select
  using (
    exists (
      select 1
      from public.business b
      where b.id = workers.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = workers.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager')
    )
    or (
      workers.user_id = auth.uid()
      and exists (
        select 1
        from public.business_members bm
        where bm.business_id = workers.business_id
          and bm.user_id = auth.uid()
          and bm.role = 'employee'
      )
    )
  );

-- INSERT/UPDATE/DELETE: owner/manager only
create policy "workers_insert_owner_or_manager"
  on public.workers
  for insert
  with check (
    exists (
      select 1
      from public.business b
      where b.id = workers.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = workers.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager')
    )
  );

create policy "workers_update_owner_or_manager"
  on public.workers
  for update
  using (
    exists (
      select 1
      from public.business b
      where b.id = workers.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = workers.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager')
    )
  )
  with check (
    exists (
      select 1
      from public.business b
      where b.id = workers.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = workers.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager')
    )
  );

create policy "workers_delete_owner_or_manager"
  on public.workers
  for delete
  using (
    exists (
      select 1
      from public.business b
      where b.id = workers.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = workers.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager')
    )
  );

notify pgrst, 'reload schema';


