-- Ensure business_settings.clock_shift_presets exists for shift buttons.
-- Safe to re-run.

alter table if exists public.business_settings
  add column if not exists clock_shift_presets jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';


