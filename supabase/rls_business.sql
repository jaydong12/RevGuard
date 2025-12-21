-- RLS for public.business
-- Ensures logged-in users can SELECT/INSERT/UPDATE/DELETE only their own business rows.
-- Safe to re-run.

alter table if exists public.business
  add column if not exists owner_id uuid;

do $$
begin
  begin
    alter table public.business
      add constraint business_owner_id_fkey
      foreign key (owner_id) references auth.users(id)
      on delete set null;
  exception when duplicate_object then
    null;
  end;
end $$;

alter table if exists public.business enable row level security;

drop policy if exists "business_select_own" on public.business;
drop policy if exists "business_insert_own" on public.business;
drop policy if exists "business_update_own" on public.business;
drop policy if exists "business_delete_own" on public.business;

create policy "business_select_own"
  on public.business
  for select
  using (auth.uid() = owner_id);

create policy "business_insert_own"
  on public.business
  for insert
  with check (auth.uid() = owner_id);

create policy "business_update_own"
  on public.business
  for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "business_delete_own"
  on public.business
  for delete
  using (auth.uid() = owner_id);


