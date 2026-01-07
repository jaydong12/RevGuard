-- Ensure geofence columns exist on public.business_settings.
-- Safe to re-run.

alter table if exists public.business_settings
  add column if not exists allowed_lat numeric(10,7),
  add column if not exists allowed_lng numeric(10,7),
  add column if not exists allowed_radius_m integer not null default 250;

notify pgrst, 'reload schema';


