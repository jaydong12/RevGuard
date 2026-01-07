-- Harden business_settings for Workers/Clock:
-- - ensure clock/geofence columns exist (plus enforcement toggles)
-- - ensure one row per business (seed missing)
-- - RLS: members can SELECT; only owner/manager can INSERT/UPDATE
-- Safe to re-run.

-- Columns (safe if already present).
alter table if exists public.business_settings
  add column if not exists clock_in_start time not null default '05:00:00',
  add column if not exists clock_in_end time not null default '23:00:00',
  add column if not exists allowed_lat numeric(10,7),
  add column if not exists allowed_lng numeric(10,7),
  add column if not exists allowed_radius_m integer not null default 250,
  add column if not exists enforce_clock_window boolean not null default true,
  add column if not exists enforce_geofence boolean not null default false;

-- Ensure business_id is unique (already PK in this repo, but safe to assert).
create unique index if not exists business_settings_business_id_uniq
  on public.business_settings (business_id);

-- Seed one settings row per business (idempotent).
insert into public.business_settings (business_id, owner_id)
select b.id, b.owner_id
from public.business b
where not exists (
  select 1
  from public.business_settings s
  where s.business_id = b.id
);

-- Backfill owner_id if null.
update public.business_settings s
set owner_id = b.owner_id
from public.business b
where b.id = s.business_id
  and s.owner_id is null;

-- RLS reset (drop ALL policies to avoid conflicts).
alter table public.business_settings enable row level security;
do $$
declare
  pol record;
begin
  for pol in
    select polname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'business_settings'
  loop
    execute format('drop policy if exists %I on public.business_settings', pol.polname);
  end loop;
end $$;

-- Members can read settings for their business (owner always counts as a member).
create policy "business_settings_select_members"
  on public.business_settings
  for select
  using (
    exists (
      select 1
      from public.business b
      where b.id = business_settings.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = business_settings.business_id
        and bm.user_id = auth.uid()
    )
  );

-- Only owner or manager can insert/update settings.
create policy "business_settings_insert_owner_or_manager"
  on public.business_settings
  for insert
  with check (
    exists (
      select 1
      from public.business b
      where b.id = business_settings.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = business_settings.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager')
    )
  );

create policy "business_settings_update_owner_or_manager"
  on public.business_settings
  for update
  using (
    exists (
      select 1
      from public.business b
      where b.id = business_settings.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = business_settings.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager')
    )
  )
  with check (
    exists (
      select 1
      from public.business b
      where b.id = business_settings.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = business_settings.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager')
    )
  );

notify pgrst, 'reload schema';


