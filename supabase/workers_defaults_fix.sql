-- Ensure workers defaults match app expectations.
-- Safe to re-run.

alter table public.workers
  alter column is_active set default true,
  alter column created_at set default now();

-- If these columns are unexpectedly nullable in an older environment, enforce NOT NULL.
-- (Will fail if existing rows violate this.)
alter table public.workers
  alter column is_active set not null,
  alter column created_at set not null;

notify pgrst, 'reload schema';


