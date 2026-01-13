-- Notifications v2 (minimal + functional)
-- - public.notifications: business-scoped alerts with read/dismiss state
-- - Designed for realtime subscriptions in the app
-- Safe to re-run.

create extension if not exists pgcrypto;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  business_id uuid not null references public.business(id) on delete cascade,

  -- Grouping / classification (for UI summaries)
  kind text not null default 'other',      -- bills | bookings | workers | other
  group_key text,                          -- optional explicit grouping key

  -- Content
  title text not null,
  body text,
  action_url text,

  -- State
  read_at timestamptz,
  dismissed_at timestamptz
);

create index if not exists notifications_business_created_idx
  on public.notifications (business_id, created_at desc);

create index if not exists notifications_business_read_idx
  on public.notifications (business_id, read_at);

create index if not exists notifications_business_dismissed_idx
  on public.notifications (business_id, dismissed_at);

alter table public.notifications enable row level security;

-- Drop existing policies (if any) to avoid conflicts
do $$
declare
  pol record;
begin
  for pol in
    select polname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'notifications'
  loop
    execute format('drop policy if exists %I on public.notifications', pol.polname);
  end loop;
end $$;

-- Members (owner or business_members) can read notifications for their business
create policy "notifications_select_members"
  on public.notifications
  for select
  using (
    exists (
      select 1
      from public.business b
      where b.id = notifications.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = notifications.business_id
        and bm.user_id = auth.uid()
    )
  );

-- Only owners can create notifications (in practice, server jobs can use service role bypass)
create policy "notifications_insert_owner"
  on public.notifications
  for insert
  with check (
    notifications.business_id in (
      select b.id
      from public.business b
      where b.owner_id = auth.uid()
    )
  );

-- Members can update (mark read / dismiss) notifications for their business
create policy "notifications_update_members"
  on public.notifications
  for update
  using (
    exists (
      select 1
      from public.business b
      where b.id = notifications.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = notifications.business_id
        and bm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.business b
      where b.id = notifications.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = notifications.business_id
        and bm.user_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';


