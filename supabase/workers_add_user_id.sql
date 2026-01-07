-- Link a worker record to an auth user for self clock-in.
-- Safe to re-run.

alter table public.workers
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists workers_business_user_idx
  on public.workers (business_id, user_id);

notify pgrst, 'reload schema';


