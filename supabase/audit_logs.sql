-- Audit logs for admin + sensitive actions (server-side writes).
-- NOTE: Uses uuid_generate_v4() from uuid-ossp.

create extension if not exists "uuid-ossp";

create table if not exists public.audit_logs (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz not null default now(),
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  target_user_id uuid null,
  target_business_id uuid null references public.business(id) on delete set null,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_user_id, created_at desc);
create index if not exists audit_logs_target_user_idx on public.audit_logs (target_user_id, created_at desc);


