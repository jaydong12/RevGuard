-- AI insight runs: saved analysis results per user/business so users can view history.

create extension if not exists pgcrypto;

create table if not exists public.ai_insight_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.business(id) on delete cascade,
  preset text not null, -- '30d' | '90d' | 'ytd' | 'custom'
  from_date date not null,
  to_date date not null,
  prompt text, -- optional: follow-up label or note
  result jsonb not null
);

create index if not exists ai_insight_runs_user_business_created_at_idx
  on public.ai_insight_runs (user_id, business_id, created_at desc);

alter table public.ai_insight_runs enable row level security;

create policy "ai_insight_runs_select_own"
  on public.ai_insight_runs
  for select
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.business b
      where b.id = ai_insight_runs.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "ai_insight_runs_insert_own"
  on public.ai_insight_runs
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.business b
      where b.id = ai_insight_runs.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "ai_insight_runs_delete_own"
  on public.ai_insight_runs
  for delete
  using (auth.uid() = user_id);


