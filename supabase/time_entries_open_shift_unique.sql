-- Prevent multiple open shifts per worker (clock_out_at IS NULL).
-- Safe to re-run.

create unique index if not exists time_entries_one_open_per_worker
  on public.time_entries (business_id, worker_id)
  where clock_out_at is null;

notify pgrst, 'reload schema';


