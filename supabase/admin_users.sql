-- Admin allowlist for server-only admin routes.
-- One row per admin user. Keep this table small and tightly controlled.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Insert your user id as admin (replace with your auth.users.id).
-- Example:
-- insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-000000000000')
-- on conflict (user_id) do nothing;


