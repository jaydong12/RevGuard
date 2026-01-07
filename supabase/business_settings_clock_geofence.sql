-- Clock-in window + geofence settings (stored on business_settings)
-- Safe to re-run.

alter table if exists public.business_settings
  add column if not exists clock_in_start time not null default '05:00',
  add column if not exists clock_in_end time not null default '23:00',
  add column if not exists allowed_lat numeric(10,7),
  add column if not exists allowed_lng numeric(10,7),
  add column if not exists allowed_radius_m integer not null default 250;

-- Allow employees (profiles.role='employee') to read their business settings for clock restrictions.
alter table public.business_settings enable row level security;

drop policy if exists "business_settings_select_employee" on public.business_settings;
create policy "business_settings_select_employee"
  on public.business_settings
  for select
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'employee'
        and p.business_id = business_settings.business_id
    )
  );

notify pgrst, 'reload schema';


