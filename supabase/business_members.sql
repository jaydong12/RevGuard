-- Business members (owner + employees) mapping.
-- Uses `public.business` (singular) in this repo.
-- Safe to re-run.

create table if not exists public.business_members (
  id bigserial primary key,
  business_id uuid not null references public.business(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'employee' check (role in ('owner','manager','employee')),
  worker_id bigint references public.workers(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists business_members_business_user_uniq
  on public.business_members (business_id, user_id);

create index if not exists business_members_user_idx
  on public.business_members (user_id);

alter table public.business_members enable row level security;

-- IMPORTANT:
-- Some environments may have older/experimental policies that reference public.business_members
-- inside business_members policies, which can trigger "infinite recursion detected".
-- To prevent that, drop ALL existing policies on this table before recreating safe ones.
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

-- Owner can read all members for their business; employees can read their own membership row.
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

-- Only owner can add members to their business.
-- NOTE: We intentionally do NOT reference business_members here (to avoid recursion).
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

-- -------------------------
-- Notes / debugging:
-- - Do NOT paste placeholder tokens like <WORKER_ID> or <BUSINESS_ID>; Postgres will throw 22P02.
-- - If you already know the real IDs, manual insert looks like:
--     insert into public.business_members (business_id, user_id, role, worker_id)
--     values ('YOUR_BUSINESS_UUID', 'YOUR_AUTH_USER_UUID', 'employee', YOUR_WORKER_ID);
--
-- - If you are in SQL editor and want to insert by email (requires access to auth.users),
--   use INSERT ... SELECT (by email; no placeholder tokens):
--     insert into public.business_members (business_id, user_id, role)
--     select b.id, u.id, 'employee'
--     from public.business b
--     join auth.users u on lower(u.email) = lower('employee@example.com')
--     where b.id = 'YOUR_BUSINESS_UUID';
--
--   (In app code, prefer using the invite flow which returns the real invited user UUID.)

notify pgrst, 'reload schema';


