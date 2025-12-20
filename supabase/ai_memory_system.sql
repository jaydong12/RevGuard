-- Advanced AI memory system for AI Advisor (business-scoped).
-- Tables:
-- - ai_business_memory: rolling memory + structured facts/preferences
-- - ai_advice_log: full interaction log (prompt/answer/kpis/etc.)
-- - ai_recommendations: actionable items emitted by the model
-- - ai_outcome_snapshots: daily KPI snapshots for learning
--
-- RLS rule: a row is accessible only if the row.business_id belongs to the authed user:
--   exists (select 1 from public.business b where b.id = <row>.business_id and b.owner_id = auth.uid())

create extension if not exists pgcrypto;

-- -------------------------
-- public.ai_business_memory
-- -------------------------
create table if not exists public.ai_business_memory (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  business_id uuid not null references public.business(id) on delete cascade,
  memory_text text not null default '',
  facts jsonb not null default '{}'::jsonb,
  preferences jsonb not null default '{}'::jsonb
);

create unique index if not exists ai_business_memory_business_id_uq
  on public.ai_business_memory (business_id);

alter table public.ai_business_memory enable row level security;

drop policy if exists "ai_business_memory_select_own" on public.ai_business_memory;
drop policy if exists "ai_business_memory_insert_own" on public.ai_business_memory;
drop policy if exists "ai_business_memory_update_own" on public.ai_business_memory;
drop policy if exists "ai_business_memory_delete_own" on public.ai_business_memory;

create policy "ai_business_memory_select_own"
  on public.ai_business_memory
  for select
  using (
    exists (
      select 1 from public.business b
      where b.id = ai_business_memory.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "ai_business_memory_insert_own"
  on public.ai_business_memory
  for insert
  with check (
    exists (
      select 1 from public.business b
      where b.id = ai_business_memory.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "ai_business_memory_update_own"
  on public.ai_business_memory
  for update
  using (
    exists (
      select 1 from public.business b
      where b.id = ai_business_memory.business_id
        and b.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.business b
      where b.id = ai_business_memory.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "ai_business_memory_delete_own"
  on public.ai_business_memory
  for delete
  using (
    exists (
      select 1 from public.business b
      where b.id = ai_business_memory.business_id
        and b.owner_id = auth.uid()
    )
  );

-- -------------------------
-- public.ai_advice_log
-- -------------------------
create table if not exists public.ai_advice_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  business_id uuid not null references public.business(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null default 'support',
  model text,
  prompt text not null,
  answer text not null,
  kpis jsonb not null default '{}'::jsonb,
  new_recommendations jsonb not null default '[]'::jsonb,
  memory_patch jsonb not null default '{}'::jsonb
);

create index if not exists ai_advice_log_business_created_at_idx
  on public.ai_advice_log (business_id, created_at desc);

alter table public.ai_advice_log enable row level security;

drop policy if exists "ai_advice_log_select_own" on public.ai_advice_log;
drop policy if exists "ai_advice_log_insert_own" on public.ai_advice_log;
drop policy if exists "ai_advice_log_delete_own" on public.ai_advice_log;

create policy "ai_advice_log_select_own"
  on public.ai_advice_log
  for select
  using (
    exists (
      select 1 from public.business b
      where b.id = ai_advice_log.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "ai_advice_log_insert_own"
  on public.ai_advice_log
  for insert
  with check (
    exists (
      select 1 from public.business b
      where b.id = ai_advice_log.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "ai_advice_log_delete_own"
  on public.ai_advice_log
  for delete
  using (
    exists (
      select 1 from public.business b
      where b.id = ai_advice_log.business_id
        and b.owner_id = auth.uid()
    )
  );

-- -------------------------
-- public.ai_recommendations
-- -------------------------
create table if not exists public.ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  business_id uuid not null references public.business(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  advice_log_id uuid null references public.ai_advice_log(id) on delete set null,
  recommendation text not null,
  status text not null default 'new'
);

create index if not exists ai_recommendations_business_created_at_idx
  on public.ai_recommendations (business_id, created_at desc);

alter table public.ai_recommendations enable row level security;

drop policy if exists "ai_recommendations_select_own" on public.ai_recommendations;
drop policy if exists "ai_recommendations_insert_own" on public.ai_recommendations;
drop policy if exists "ai_recommendations_update_own" on public.ai_recommendations;
drop policy if exists "ai_recommendations_delete_own" on public.ai_recommendations;

create policy "ai_recommendations_select_own"
  on public.ai_recommendations
  for select
  using (
    exists (
      select 1 from public.business b
      where b.id = ai_recommendations.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "ai_recommendations_insert_own"
  on public.ai_recommendations
  for insert
  with check (
    exists (
      select 1 from public.business b
      where b.id = ai_recommendations.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "ai_recommendations_update_own"
  on public.ai_recommendations
  for update
  using (
    exists (
      select 1 from public.business b
      where b.id = ai_recommendations.business_id
        and b.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.business b
      where b.id = ai_recommendations.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "ai_recommendations_delete_own"
  on public.ai_recommendations
  for delete
  using (
    exists (
      select 1 from public.business b
      where b.id = ai_recommendations.business_id
        and b.owner_id = auth.uid()
    )
  );

-- -------------------------
-- public.ai_outcome_snapshots
-- -------------------------
create table if not exists public.ai_outcome_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  business_id uuid not null references public.business(id) on delete cascade,
  snapshot_date date not null,
  revenue_30d numeric(14,2) not null default 0,
  expenses_30d numeric(14,2) not null default 0,
  net_30d numeric(14,2) not null default 0,
  cash_estimate numeric(14,2) not null default 0,
  kpis jsonb not null default '{}'::jsonb
);

create unique index if not exists ai_outcome_snapshots_business_day_uq
  on public.ai_outcome_snapshots (business_id, snapshot_date);

alter table public.ai_outcome_snapshots enable row level security;

drop policy if exists "ai_outcome_snapshots_select_own" on public.ai_outcome_snapshots;
drop policy if exists "ai_outcome_snapshots_insert_own" on public.ai_outcome_snapshots;
drop policy if exists "ai_outcome_snapshots_update_own" on public.ai_outcome_snapshots;
drop policy if exists "ai_outcome_snapshots_delete_own" on public.ai_outcome_snapshots;

create policy "ai_outcome_snapshots_select_own"
  on public.ai_outcome_snapshots
  for select
  using (
    exists (
      select 1 from public.business b
      where b.id = ai_outcome_snapshots.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "ai_outcome_snapshots_insert_own"
  on public.ai_outcome_snapshots
  for insert
  with check (
    exists (
      select 1 from public.business b
      where b.id = ai_outcome_snapshots.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "ai_outcome_snapshots_update_own"
  on public.ai_outcome_snapshots
  for update
  using (
    exists (
      select 1 from public.business b
      where b.id = ai_outcome_snapshots.business_id
        and b.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.business b
      where b.id = ai_outcome_snapshots.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "ai_outcome_snapshots_delete_own"
  on public.ai_outcome_snapshots
  for delete
  using (
    exists (
      select 1 from public.business b
      where b.id = ai_outcome_snapshots.business_id
        and b.owner_id = auth.uid()
    )
  );


