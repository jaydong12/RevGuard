-- RevGuard Memory Engine v1
-- One memory row per business to guide tone/priorities for AI (never force actions).
-- Table: public.business_intelligence_memory
-- Columns:
--   business_id (uuid, unique), business_dna (jsonb), owner_preferences (jsonb),
--   decision_history (jsonb), ai_assumptions (jsonb), updated_at (timestamptz)
--
-- RLS: a row is accessible only if the business belongs to the authed user:
--   exists (select 1 from public.business b where b.id = <row>.business_id and b.owner_id = auth.uid())

create extension if not exists pgcrypto;

create table if not exists public.business_intelligence_memory (
  business_id uuid primary key references public.business(id) on delete cascade,
  business_dna jsonb not null default '{}'::jsonb,
  owner_preferences jsonb not null default '{}'::jsonb,
  decision_history jsonb not null default '[]'::jsonb,
  ai_assumptions jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- (business_id is already unique via primary key; keep explicit index for clarity/perf.)
create unique index if not exists business_intelligence_memory_business_id_uq
  on public.business_intelligence_memory (business_id);

-- updated_at trigger
create or replace function public.set_business_intelligence_memory_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_business_intelligence_memory_updated_at on public.business_intelligence_memory;
create trigger set_business_intelligence_memory_updated_at
before update on public.business_intelligence_memory
for each row execute procedure public.set_business_intelligence_memory_updated_at();

alter table public.business_intelligence_memory enable row level security;

drop policy if exists "business_intelligence_memory_select_own" on public.business_intelligence_memory;
drop policy if exists "business_intelligence_memory_insert_own" on public.business_intelligence_memory;
drop policy if exists "business_intelligence_memory_update_own" on public.business_intelligence_memory;
drop policy if exists "business_intelligence_memory_delete_own" on public.business_intelligence_memory;

create policy "business_intelligence_memory_select_own"
  on public.business_intelligence_memory
  for select
  using (
    exists (
      select 1 from public.business b
      where b.id = business_intelligence_memory.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "business_intelligence_memory_insert_own"
  on public.business_intelligence_memory
  for insert
  with check (
    exists (
      select 1 from public.business b
      where b.id = business_intelligence_memory.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "business_intelligence_memory_update_own"
  on public.business_intelligence_memory
  for update
  using (
    exists (
      select 1 from public.business b
      where b.id = business_intelligence_memory.business_id
        and b.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.business b
      where b.id = business_intelligence_memory.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "business_intelligence_memory_delete_own"
  on public.business_intelligence_memory
  for delete
  using (
    exists (
      select 1 from public.business b
      where b.id = business_intelligence_memory.business_id
        and b.owner_id = auth.uid()
    )
  );


