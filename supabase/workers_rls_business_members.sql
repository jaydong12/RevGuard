-- Workers RLS based on public.business_members (main + sub-accounts).
-- Requirements:
-- - members can SELECT workers for their business
-- - only owner/manager can INSERT/UPDATE/DELETE workers
-- Uses public.business (singular).
-- Safe to re-run.

alter table public.workers enable row level security;

-- Replace any earlier workers policies.
drop policy if exists "workers_select_own" on public.workers;
drop policy if exists "workers_select_owner_or_employee" on public.workers;
drop policy if exists "workers_select_owner_or_employee_debug" on public.workers;
drop policy if exists "workers_select_owner_debug" on public.workers;
drop policy if exists "workers_insert_own" on public.workers;
drop policy if exists "workers_update_own" on public.workers;
drop policy if exists "workers_delete_own" on public.workers;

create policy "workers_select_members"
  on public.workers
  for select
  using (
    -- Owner always has access, even if no membership row exists.
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
    )
  );

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


