-- Shift preset buttons for employee clock-in (morning/noon/late shift, etc.)
-- Stored on business_settings so only owners manage them, employees can read them.
-- Safe to re-run.

alter table if exists public.business_settings
  add column if not exists clock_shift_presets jsonb not null default '[]'::jsonb;

-- Audit: store which preset employee selected when clocking in.
alter table if exists public.time_entries
  add column if not exists shift_label text,
  add column if not exists shift_start_hhmm text;

-- Optional: basic format check for HH:MM if the column is present.
do $$
begin
  begin
    alter table public.time_entries
      add constraint time_entries_shift_start_hhmm_format
      check (shift_start_hhmm is null or shift_start_hhmm ~ '^\d{2}:\d{2}$');
  exception when duplicate_object then
    null;
  end;
end $$;

notify pgrst, 'reload schema';


