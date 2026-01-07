-- Employee login + self clock-in (profiles role mapping + RLS)
-- Safe to re-run.

-- -------------------------
-- Role enum
-- -------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'profile_role') then
    create type public.profile_role as enum ('owner', 'employee');
  end if;
end $$;

-- -------------------------
-- Extend public.profiles
-- -------------------------
alter table public.profiles
  add column if not exists business_id uuid;
alter table public.profiles
  add column if not exists role public.profile_role not null default 'owner';
alter table public.profiles
  add column if not exists worker_id bigint;

-- Add FKs best-effort (avoid failing if tables aren't created yet).
do $$
begin
  if to_regclass('public.business') is not null then
    begin
      alter table public.profiles
        add constraint profiles_business_id_fkey
        foreign key (business_id) references public.business(id)
        on delete cascade;
    exception when duplicate_object then null;
    end;
  end if;

  if to_regclass('public.workers') is not null then
    begin
      alter table public.profiles
        add constraint profiles_worker_id_fkey
        foreign key (worker_id) references public.workers(id)
        on delete set null;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- Backfill business_id for existing owner profiles when possible (first business for that owner).
do $$
begin
  if to_regclass('public.business') is not null then
    update public.profiles p
    set business_id = b.id
    from (
      select distinct on (owner_id) owner_id, id
      from public.business
      where owner_id is not null
      order by owner_id, created_at asc
    ) b
    where p.business_id is null
      and p.id = b.owner_id;
  end if;
end $$;

-- -------------------------
-- Update RLS for profiles:
-- - User can read/write their own profile row
-- - Business owner can read/write profiles for their business (to link employees)
-- -------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_delete_own" on public.profiles;

create policy "profiles_select_own_or_owner"
  on public.profiles
  for select
  using (
    auth.uid() = id
    or (
      profiles.business_id is not null
      and exists (
        select 1
        from public.business b
        where b.id = profiles.business_id
          and b.owner_id = auth.uid()
      )
    )
  );

create policy "profiles_insert_own_or_owner"
  on public.profiles
  for insert
  with check (
    auth.uid() = id
    or (
      profiles.business_id is not null
      and exists (
        select 1
        from public.business b
        where b.id = profiles.business_id
          and b.owner_id = auth.uid()
      )
    )
  );

create policy "profiles_update_own_or_owner"
  on public.profiles
  for update
  using (
    auth.uid() = id
    or (
      profiles.business_id is not null
      and exists (
        select 1
        from public.business b
        where b.id = profiles.business_id
          and b.owner_id = auth.uid()
      )
    )
  )
  with check (
    auth.uid() = id
    or (
      profiles.business_id is not null
      and exists (
        select 1
        from public.business b
        where b.id = profiles.business_id
          and b.owner_id = auth.uid()
      )
    )
  );

create policy "profiles_delete_own"
  on public.profiles
  for delete
  using (auth.uid() = id);

notify pgrst, 'reload schema';


