-- Fix "infinite recursion detected" on business_members RLS.
-- Drops ALL existing policies on public.business_members and recreates safe, non-recursive policies.
-- Safe to re-run.
--
-- Key rule: business_members policies must NOT reference public.business_members in subqueries.
-- Owner access is determined via public.business.owner_id = auth.uid().
-- Self access is determined via business_members.user_id = auth.uid().

alter table public.business_members enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select polname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'business_members'
  loop
    execute format('drop policy if exists %I on public.business_members', pol.polname);
  end loop;
end $$;

create policy "business_members_select_owner_or_self"
  on public.business_members
  for select
  using (
    exists (
      select 1
      from public.business b
      where b.id = business_members.business_id
        and b.owner_id = auth.uid()
    )
    or business_members.user_id = auth.uid()
  );

create policy "business_members_insert_owner_only"
  on public.business_members
  for insert
  with check (
    business_members.business_id in (
      select b.id
      from public.business b
      where b.owner_id = auth.uid()
    )
  );

create policy "business_members_update_owner_only"
  on public.business_members
  for update
  using (
    exists (
      select 1
      from public.business b
      where b.id = business_members.business_id
        and b.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.business b
      where b.id = business_members.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "business_members_delete_owner_only"
  on public.business_members
  for delete
  using (
    exists (
      select 1
      from public.business b
      where b.id = business_members.business_id
        and b.owner_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';


