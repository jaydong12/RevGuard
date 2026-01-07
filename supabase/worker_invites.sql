-- Worker invites (lightweight invite registry; no email sending yet).
-- Safe to re-run.
--
-- Purpose:
-- - Owner/manager records an invite for an email + role
-- - Later, on signup, we can match the auth user's email to an invite and link them to the business/worker.

create table if not exists public.worker_invites (
  id bigserial primary key,
  business_id uuid not null references public.business(id) on delete cascade,
  email text not null,
  role text not null default 'employee' check (role in ('employee','manager')),
  accepted boolean not null default false,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists worker_invites_business_email_uniq
  on public.worker_invites (business_id, lower(email));

create index if not exists worker_invites_business_created_idx
  on public.worker_invites (business_id, created_at desc);

create or replace function public.worker_invites_set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at := now();
  return new;
end
$fn$;

drop trigger if exists worker_invites_set_updated_at_trg on public.worker_invites;
create trigger worker_invites_set_updated_at_trg
  before update on public.worker_invites
  for each row execute function public.worker_invites_set_updated_at();

alter table public.worker_invites enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select polname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'worker_invites'
  loop
    execute format('drop policy if exists %I on public.worker_invites', pol.polname);
  end loop;
end $$;

-- Owner/manager can manage invites for their business.
create policy "worker_invites_select_owner_or_manager"
  on public.worker_invites
  for select
  using (
    exists (
      select 1
      from public.business b
      where b.id = worker_invites.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = worker_invites.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager')
    )
  );

create policy "worker_invites_insert_owner_or_manager"
  on public.worker_invites
  for insert
  with check (
    exists (
      select 1
      from public.business b
      where b.id = worker_invites.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = worker_invites.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager')
    )
  );

create policy "worker_invites_update_owner_or_manager"
  on public.worker_invites
  for update
  using (
    exists (
      select 1
      from public.business b
      where b.id = worker_invites.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = worker_invites.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager')
    )
  )
  with check (
    exists (
      select 1
      from public.business b
      where b.id = worker_invites.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = worker_invites.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager')
    )
  );

create policy "worker_invites_delete_owner_or_manager"
  on public.worker_invites
  for delete
  using (
    exists (
      select 1
      from public.business b
      where b.id = worker_invites.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = worker_invites.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager')
    )
  );

notify pgrst, 'reload schema';


