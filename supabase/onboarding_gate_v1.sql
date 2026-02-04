-- Onboarding gate v1
-- Enforces first-run onboarding via profiles.onboarding_complete + onboarding_step.
-- Safe to re-run.

-- -------------------------
-- profiles fields
-- -------------------------
alter table if exists public.profiles
  add column if not exists onboarding_complete boolean not null default false;

alter table if exists public.profiles
  add column if not exists onboarding_step text not null default 'business';

-- -------------------------
-- business field
-- -------------------------
alter table if exists public.business
  add column if not exists is_setup_complete boolean not null default false;

-- -------------------------
-- business RLS: allow members to read business and privileged roles to update.
-- (Owner-only policies make invited admins/managers unusable in onboarding/settings.)
-- -------------------------
alter table if exists public.business enable row level security;

drop policy if exists "business_select_own" on public.business;
drop policy if exists "business_insert_own" on public.business;
drop policy if exists "business_update_own" on public.business;
drop policy if exists "business_delete_own" on public.business;

create policy "business_select_members"
  on public.business
  for select
  using (
    auth.uid() = owner_id
    or exists (
      select 1 from public.business_members bm
      where bm.business_id = business.id and bm.user_id = auth.uid()
    )
  );

create policy "business_insert_owner"
  on public.business
  for insert
  with check (auth.uid() = owner_id);

create policy "business_update_owner_manager_admin"
  on public.business
  for update
  using (
    auth.uid() = owner_id
    or exists (
      select 1 from public.business_members bm
      where bm.business_id = business.id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager','admin')
    )
  )
  with check (
    auth.uid() = owner_id
    or exists (
      select 1 from public.business_members bm
      where bm.business_id = business.id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager','admin')
    )
  );

create policy "business_delete_owner"
  on public.business
  for delete
  using (auth.uid() = owner_id);

notify pgrst, 'reload schema';


