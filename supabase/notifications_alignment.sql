-- Notifications table alignment (v3)
-- Ensures `public.notifications` matches the app contract:
-- id, business_id, user_id, type, title, body, action_url, severity,
-- is_read (bool default false), dismissed_at (timestamptz), created_at.
-- Safe to re-run.

create extension if not exists pgcrypto;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null default 'general',
  title text not null default '',
  body text not null default '',
  action_url text,
  severity text not null default 'info',
  is_read boolean not null default false,
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);

-- If the table already existed, make sure columns exist (safe to re-run).
alter table public.notifications add column if not exists business_id uuid;
alter table public.notifications add column if not exists user_id uuid;
alter table public.notifications add column if not exists type text;
alter table public.notifications add column if not exists title text;
alter table public.notifications add column if not exists body text;
alter table public.notifications add column if not exists action_url text;
alter table public.notifications add column if not exists severity text;
alter table public.notifications add column if not exists is_read boolean not null default false;
alter table public.notifications add column if not exists dismissed_at timestamptz;
alter table public.notifications add column if not exists created_at timestamptz not null default now();

create index if not exists notifications_business_created_idx
  on public.notifications (business_id, created_at desc);

create index if not exists notifications_business_active_idx
  on public.notifications (business_id, dismissed_at, created_at desc);

create index if not exists notifications_user_active_idx
  on public.notifications (user_id, dismissed_at, created_at desc);

alter table public.notifications enable row level security;

-- Drop existing policies to avoid recursion/overlap.
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

-- SELECT: any business member can read notifications for their business.
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

-- UPDATE: users may mark/dismiss their own notifications (by user_id) within their business.
create policy "notifications_update_own"
  on public.notifications
  for update
  using (notifications.user_id = auth.uid())
  with check (notifications.user_id = auth.uid());

-- INSERT/DELETE: owner/manager only (typically created by server jobs).
create policy "notifications_insert_owner_or_manager"
  on public.notifications
  for insert
  with check (
    notifications.business_id in (
      select b.id from public.business b where b.owner_id = auth.uid()
    )
    or notifications.business_id in (
      select bm.business_id from public.business_members bm
      where bm.user_id = auth.uid()
        and bm.role in ('owner','manager','admin')
    )
  );

create policy "notifications_delete_owner_or_manager"
  on public.notifications
  for delete
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
        and bm.role in ('owner','manager','admin')
    )
  );

notify pgrst, 'reload schema';


