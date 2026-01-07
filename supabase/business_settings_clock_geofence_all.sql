-- Ensure all employee clock restriction settings exist on public.business_settings.
-- Safe to re-run.
--
-- Includes:
-- - clock_in_start / clock_in_end
-- - allowed_lat / allowed_lng / allowed_radius_m
-- - enforce_clock_window / enforce_geofence (toggles)
--
-- Defaults:
-- - enforce_clock_window: true (time window enforced)
-- - enforce_geofence: false (avoid locking everyone out until a geofence is configured)

alter table if exists public.business_settings
  add column if not exists clock_in_start time not null default '05:00:00',
  add column if not exists clock_in_end time not null default '23:00:00',
  add column if not exists allowed_lat numeric(10,7),
  add column if not exists allowed_lng numeric(10,7),
  add column if not exists allowed_radius_m integer not null default 250,
  add column if not exists enforce_clock_window boolean not null default true,
  add column if not exists enforce_geofence boolean not null default false;

notify pgrst, 'reload schema';


