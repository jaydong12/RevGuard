-- time_entries RLS for main + sub-accounts using public.business_members + workers.user_id.
-- Requirements:
-- - members can SELECT time_entries
-- - owner/manager can INSERT/UPDATE/DELETE
-- - employee can INSERT only when the worker belongs to them (workers.user_id = auth.uid())
--   AND business_id matches, AND clock_out_at is null (open entry)
-- - employee can UPDATE only to clock out their own open entry (guarded by trigger)
-- Safe to re-run.

alter table public.time_entries enable row level security;

drop policy if exists "time_entries_select_own" on public.time_entries;
drop policy if exists "time_entries_select_owner_or_employee" on public.time_entries;
drop policy if exists "time_entries_insert_own" on public.time_entries;
drop policy if exists "time_entries_insert_owner_or_employee" on public.time_entries;
drop policy if exists "time_entries_update_own" on public.time_entries;
drop policy if exists "time_entries_update_owner_or_employee_open_only" on public.time_entries;
drop policy if exists "time_entries_delete_own" on public.time_entries;
drop policy if exists "time_entries_delete_owner_only" on public.time_entries;

create policy "time_entries_select_members"
  on public.time_entries
  for select
  using (
    exists (
      select 1
      from public.business b
      where b.id = time_entries.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = time_entries.business_id
        and bm.user_id = auth.uid()
    )
  );

create policy "time_entries_insert_owner_manager_or_employee_own"
  on public.time_entries
  for insert
  with check (
    -- owner / manager
    exists (
      select 1
      from public.business b
      where b.id = time_entries.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = time_entries.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager')
    )
    or (
      -- employee self clock-in
      time_entries.clock_out_at is null
      and exists (
        select 1
        from public.business_members bm
        join public.workers w on w.id = time_entries.worker_id
        where bm.business_id = time_entries.business_id
          and bm.user_id = auth.uid()
          and bm.role = 'employee'
          and w.business_id = time_entries.business_id
          and w.user_id = auth.uid()
      )
    )
  );

create policy "time_entries_update_owner_manager_or_employee_own_open_only"
  on public.time_entries
  for update
  using (
    -- owner / manager
    exists (
      select 1
      from public.business b
      where b.id = time_entries.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = time_entries.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager')
    )
    or (
      -- employee self clock-out only on open entries
      time_entries.clock_out_at is null
      and exists (
        select 1
        from public.business_members bm
        join public.workers w on w.id = time_entries.worker_id
        where bm.business_id = time_entries.business_id
          and bm.user_id = auth.uid()
          and bm.role = 'employee'
          and w.business_id = time_entries.business_id
          and w.user_id = auth.uid()
      )
    )
  )
  with check (
    -- owner / manager
    exists (
      select 1
      from public.business b
      where b.id = time_entries.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = time_entries.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager')
    )
    or exists (
      -- employee: row must still belong to them
      select 1
      from public.business_members bm
      join public.workers w on w.id = time_entries.worker_id
      where bm.business_id = time_entries.business_id
        and bm.user_id = auth.uid()
        and bm.role = 'employee'
        and w.business_id = time_entries.business_id
        and w.user_id = auth.uid()
    )
  );

create policy "time_entries_delete_owner_or_manager"
  on public.time_entries
  for delete
  using (
    exists (
      select 1
      from public.business b
      where b.id = time_entries.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = time_entries.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager')
    )
  );

-- Guardrails: employees can't manually edit clock_in_at / worker_id / business_id.
-- They may only set clock_out_at (once) and clock_lat/clock_lng.
create or replace function public.enforce_employee_time_entry_updates()
returns trigger
language plpgsql
as $fn$
begin
  if exists (
    select 1
    from public.business_members bm
    where bm.user_id = auth.uid()
      and bm.role = 'employee'
      and bm.business_id = old.business_id
  ) then
    if new.business_id <> old.business_id then
      raise exception 'Employees cannot change business_id';
    end if;
    if new.worker_id <> old.worker_id then
      raise exception 'Employees cannot change worker_id';
    end if;
    if new.clock_in_at <> old.clock_in_at then
      raise exception 'Employees cannot change clock_in_at';
    end if;
    if old.clock_out_at is not null then
      raise exception 'Employees cannot edit closed time entries';
    end if;
    if new.clock_out_at is null then
      raise exception 'Employees cannot clear clock_out_at';
    end if;
  end if;

  return new;
end
$fn$;

drop trigger if exists enforce_employee_time_entry_updates_trg on public.time_entries;
create trigger enforce_employee_time_entry_updates_trg
  before update on public.time_entries
  for each row execute function public.enforce_employee_time_entry_updates();

notify pgrst, 'reload schema';


