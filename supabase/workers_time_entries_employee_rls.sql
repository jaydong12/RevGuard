-- Employee self clock-in: expand RLS for workers + time_entries and add audit fields.
-- Safe to re-run.

-- Audit location (store most recent clock action location for the entry).
alter table if exists public.time_entries
  add column if not exists clock_lat numeric(10,7),
  add column if not exists clock_lng numeric(10,7);

-- -------------------------
-- workers RLS
-- - owner can CRUD (existing)
-- - employee can SELECT only their own worker row (profiles.worker_id)
-- -------------------------
alter table public.workers enable row level security;

drop policy if exists "workers_select_own" on public.workers;
create policy "workers_select_owner_or_employee"
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
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'employee'
        and p.business_id = workers.business_id
        and p.worker_id = workers.id
    )
  );

-- keep insert/update/delete policies as owner-only (defined in workers_time_tracking.sql)


-- -------------------------
-- time_entries RLS
-- - owner can read/write all for their business (existing)
-- - employee can select only their own worker rows
-- - employee can clock in (insert) only for their worker (clock_out_at must be null)
-- - employee can clock out (update) only open rows for their worker
-- -------------------------
alter table public.time_entries enable row level security;

drop policy if exists "time_entries_select_own" on public.time_entries;
drop policy if exists "time_entries_insert_own" on public.time_entries;
drop policy if exists "time_entries_update_own" on public.time_entries;
drop policy if exists "time_entries_delete_own" on public.time_entries;

create policy "time_entries_select_owner_or_employee"
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
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'employee'
        and p.business_id = time_entries.business_id
        and p.worker_id = time_entries.worker_id
    )
  );

create policy "time_entries_insert_owner_or_employee"
  on public.time_entries
  for insert
  with check (
    exists (
      select 1
      from public.business b
      where b.id = time_entries.business_id
        and b.owner_id = auth.uid()
    )
    or (
      time_entries.clock_out_at is null
      and exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'employee'
          and p.business_id = time_entries.business_id
          and p.worker_id = time_entries.worker_id
      )
    )
  );

create policy "time_entries_update_owner_or_employee_open_only"
  on public.time_entries
  for update
  using (
    exists (
      select 1
      from public.business b
      where b.id = time_entries.business_id
        and b.owner_id = auth.uid()
    )
    or (
      time_entries.clock_out_at is null
      and exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'employee'
          and p.business_id = time_entries.business_id
          and p.worker_id = time_entries.worker_id
      )
    )
  )
  with check (
    exists (
      select 1
      from public.business b
      where b.id = time_entries.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'employee'
        and p.business_id = time_entries.business_id
        and p.worker_id = time_entries.worker_id
    )
  );

create policy "time_entries_delete_owner_only"
  on public.time_entries
  for delete
  using (
    exists (
      select 1
      from public.business b
      where b.id = time_entries.business_id
        and b.owner_id = auth.uid()
    )
  );

-- -------------------------
-- Guardrails: employees can't manually edit clock_in_at / worker_id / business_id.
-- They may only set clock_out_at (once) and clock_lat/clock_lng.
-- -------------------------
create or replace function public.enforce_employee_time_entry_updates()
returns trigger
language plpgsql
as $fn$
begin
  -- Only enforce when the updater is an employee.
  if exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'employee'
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
    -- Allow clock_out_at to be set once (null -> not null). Disallow edits after.
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


