-- Admin invite onboarding (business-scoped "admin" membership via invites)
-- Safe to re-run.

create table if not exists public.admin_invites (
  id bigserial primary key,
  business_id uuid not null references public.business(id) on delete cascade,
  email text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_user_id uuid references auth.users(id) on delete set null
);

create index if not exists admin_invites_business_created_idx
  on public.admin_invites (business_id, created_at desc);

create unique index if not exists admin_invites_open_unique
  on public.admin_invites (business_id, lower(email))
  where accepted_at is null;

alter table public.admin_invites enable row level security;

-- Keep RLS tight: owners can view invites for their business; users can view invites for their own email.
drop policy if exists "admin_invites_select_owner_or_email" on public.admin_invites;
create policy "admin_invites_select_owner_or_email"
  on public.admin_invites
  for select
  using (
    exists (
      select 1
      from public.business b
      where b.id = admin_invites.business_id
        and b.owner_id = auth.uid()
    )
    or lower(admin_invites.email) = lower((auth.jwt() ->> 'email'))
  );

-- Only owners can create invites (in practice we use service role from server route).
drop policy if exists "admin_invites_insert_owner_only" on public.admin_invites;
create policy "admin_invites_insert_owner_only"
  on public.admin_invites
  for insert
  with check (
    admin_invites.business_id in (
      select b.id
      from public.business b
      where b.owner_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';


