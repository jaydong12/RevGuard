-- Tax Engine v1: business toggles + payroll runs table (schema-safe).
-- Run in Supabase SQL editor.

-- 1) Business flags for tax applicability toggles
alter table public.business
  add column if not exists legal_structure text,
  add column if not exists state_code text,
  add column if not exists has_payroll boolean not null default false,
  add column if not exists sells_taxable_goods_services boolean not null default false;

-- 2) Payroll runs (optional) – supports payroll tax estimation
create table if not exists public.payroll_runs (
  id bigserial primary key,
  business_id uuid not null references public.business(id) on delete cascade,
  run_date date not null,
  gross_wages numeric not null default 0,
  employee_withholding numeric not null default 0,
  employer_payroll_tax numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, run_date)
);

create or replace function public.set_payroll_runs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_payroll_runs_updated_at on public.payroll_runs;
create trigger trg_payroll_runs_updated_at
before update on public.payroll_runs
for each row execute function public.set_payroll_runs_updated_at();

-- RLS
alter table public.payroll_runs enable row level security;

drop policy if exists "payroll_runs_select_own" on public.payroll_runs;
drop policy if exists "payroll_runs_insert_own" on public.payroll_runs;
drop policy if exists "payroll_runs_update_own" on public.payroll_runs;
drop policy if exists "payroll_runs_delete_own" on public.payroll_runs;

create policy "payroll_runs_select_own"
on public.payroll_runs
for select
using (
  exists (
    select 1 from public.business b
    where b.id = payroll_runs.business_id
      and b.owner_id = auth.uid()
  )
);

create policy "payroll_runs_insert_own"
on public.payroll_runs
for insert
with check (
  exists (
    select 1 from public.business b
    where b.id = payroll_runs.business_id
      and b.owner_id = auth.uid()
  )
);

create policy "payroll_runs_update_own"
on public.payroll_runs
for update
using (
  exists (
    select 1 from public.business b
    where b.id = payroll_runs.business_id
      and b.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.business b
    where b.id = payroll_runs.business_id
      and b.owner_id = auth.uid()
  )
);

create policy "payroll_runs_delete_own"
on public.payroll_runs
for delete
using (
  exists (
    select 1 from public.business b
    where b.id = payroll_runs.business_id
      and b.owner_id = auth.uid()
  )
);

create index if not exists payroll_runs_business_date_idx
  on public.payroll_runs (business_id, run_date);

-- Ensure PostgREST schema cache refresh after applying this migration.
notify pgrst, 'reload schema';


