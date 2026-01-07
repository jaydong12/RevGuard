-- RLS debugging helpers for workers insert failures.
-- These do NOT bypass RLS. They only expose values that help explain why a policy
-- like "business_id IN (SELECT ... WHERE owner_id = auth.uid())" is evaluating false.
-- Safe to re-run.

-- Who am I (as Postgres sees me)?
create or replace function public.rls_debug_whoami()
returns table (
  auth_uid uuid,
  auth_role text
)
language sql
security invoker
as $$
  select auth.uid() as auth_uid, auth.role() as auth_role;
$$;

-- Can I insert a worker for this business_id (according to RLS-visible rows)?
create or replace function public.rls_debug_can_insert_worker(p_business_id uuid)
returns table (
  auth_uid uuid,
  auth_role text,
  business_id uuid,
  business_visible boolean,
  is_owner boolean
)
language sql
security invoker
as $$
  select
    auth.uid() as auth_uid,
    auth.role() as auth_role,
    p_business_id as business_id,
    exists(select 1 from public.business b where b.id = p_business_id) as business_visible,
    exists(select 1 from public.business b where b.id = p_business_id and b.owner_id = auth.uid()) as is_owner;
$$;

-- Optional: ensure there is an owner select policy on workers (doesn't widen access).
-- This can help confirm whether inserts are returning rows via `.select()` for owners.
alter table public.workers enable row level security;
do $$
begin
  begin
    create policy "workers_select_owner_debug"
      on public.workers
      for select
      using (
        workers.business_id in (
          select b.id from public.business b where b.owner_id = auth.uid()
        )
      );
  exception when duplicate_object then
    null;
  end;
end $$;

notify pgrst, 'reload schema';


