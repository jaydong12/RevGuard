-- Workers + Time Tracking v1
-- Safe to re-run. Business-scoped RLS via public.business.owner_id = auth.uid().

-- -------------------------
-- public.workers
-- -------------------------
create table if not exists public.workers (
  id bigserial primary key,
  business_id uuid not null references public.business(id) on delete cascade,
  name text not null,
  role text not null default '',
  hourly_rate numeric(12,2),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists workers_business_active_idx
  on public.workers (business_id, is_active);

alter table public.workers enable row level security;
drop policy if exists "workers_select_own" on public.workers;
drop policy if exists "workers_insert_own" on public.workers;
drop policy if exists "workers_update_own" on public.workers;
drop policy if exists "workers_delete_own" on public.workers;

create policy "workers_select_own"
  on public.workers
  for select
  using (
    exists (
      select 1
      from public.business b
      where b.id = workers.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = workers.business_id
        and bm.user_id = auth.uid()
    )
  );

create policy "workers_insert_own"
  on public.workers
  for insert
  with check (
    exists (
      select 1
      from public.business b
      where b.id = workers.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = workers.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager')
    )
  );

create policy "workers_update_own"
  on public.workers
  for update
  using (
    exists (
      select 1
      from public.business b
      where b.id = workers.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = workers.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager')
    )
  )
  with check (
    exists (
      select 1
      from public.business b
      where b.id = workers.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = workers.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager')
    )
  );

create policy "workers_delete_own"
  on public.workers
  for delete
  using (
    exists (
      select 1
      from public.business b
      where b.id = workers.business_id
        and b.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = workers.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner','manager')
    )
  );


-- -------------------------
-- public.time_entries
-- -------------------------
create table if not exists public.time_entries (
  id bigserial primary key,
  business_id uuid not null references public.business(id) on delete cascade,
  worker_id bigint not null references public.workers(id) on delete cascade,
  clock_in_at timestamptz not null,
  clock_out_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists time_entries_business_worker_in_idx
  on public.time_entries (business_id, worker_id, clock_in_at desc);

create index if not exists time_entries_open_idx
  on public.time_entries (business_id, worker_id)
  where clock_out_at is null;

alter table public.time_entries enable row level security;
drop policy if exists "time_entries_select_own" on public.time_entries;
drop policy if exists "time_entries_insert_own" on public.time_entries;
drop policy if exists "time_entries_update_own" on public.time_entries;
drop policy if exists "time_entries_delete_own" on public.time_entries;

create policy "time_entries_select_own"
  on public.time_entries
  for select
  using (
    exists (
      select 1
      from public.business b
      where b.id = time_entries.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "time_entries_insert_own"
  on public.time_entries
  for insert
  with check (
    exists (
      select 1
      from public.business b
      where b.id = time_entries.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "time_entries_update_own"
  on public.time_entries
  for update
  using (
    exists (
      select 1
      from public.business b
      where b.id = time_entries.business_id
        and b.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.business b
      where b.id = time_entries.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "time_entries_delete_own"
  on public.time_entries
  for delete
  using (
    exists (
      select 1
      from public.business b
      where b.id = time_entries.business_id
        and b.owner_id = auth.uid()
    )
  );

-- Notify PostgREST to reload schema (helpful after applying migrations).
notify pgrst, 'reload schema';


