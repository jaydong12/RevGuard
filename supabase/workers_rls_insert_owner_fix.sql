-- Fix/standardize workers insert RLS to owner-owned businesses (IN (SELECT ...)).
-- Safe to re-run.
--
-- NOTE: This repo uses `public.business` (singular). If your project uses `public.businesses`,
-- adjust the table name accordingly.

alter table public.workers enable row level security;

drop policy if exists "workers_insert_own" on public.workers;

create policy "workers_insert_own"
  on public.workers
  for insert
  with check (
    workers.business_id in (
      select b.id
      from public.business b
      where b.owner_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';


