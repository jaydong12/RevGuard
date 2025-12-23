-- Business Tax Profile + tax-aware category rules
-- Run in Supabase SQL editor.

-- 1) Business tax profile fields on public.business
alter table public.business
  add column if not exists tax_entity_type text,
  add column if not exists tax_state text,
  add column if not exists tax_filing_status text,
  -- stored as decimal (e.g. 0.05 = 5%). keep nullable so UI can show "not set".
  add column if not exists tax_state_rate numeric,
  add column if not exists tax_include_self_employment boolean default true;

-- 2) Category-level tax rules (per business)
create table if not exists public.business_tax_category_rules (
  business_id uuid not null references public.business(id) on delete cascade,
  category text not null,
  -- one of: deductible, partial_50, non_deductible, non_taxable_income, review
  treatment text not null default 'review',
  -- optional explicit deduction percent for expenses (0..1). if null, derived from treatment.
  deduction_pct numeric,
  updated_at timestamptz not null default now(),
  primary key (business_id, category)
);

-- updated_at trigger
create or replace function public.set_business_tax_category_rules_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_business_tax_category_rules_updated_at on public.business_tax_category_rules;
create trigger trg_business_tax_category_rules_updated_at
before update on public.business_tax_category_rules
for each row execute function public.set_business_tax_category_rules_updated_at();

-- RLS
alter table public.business_tax_category_rules enable row level security;

drop policy if exists "tax_rules_select_own" on public.business_tax_category_rules;
drop policy if exists "tax_rules_insert_own" on public.business_tax_category_rules;
drop policy if exists "tax_rules_update_own" on public.business_tax_category_rules;
drop policy if exists "tax_rules_delete_own" on public.business_tax_category_rules;

create policy "tax_rules_select_own"
on public.business_tax_category_rules
for select
using (
  exists (
    select 1 from public.business b
    where b.id = business_tax_category_rules.business_id
      and b.owner_id = auth.uid()
  )
);

create policy "tax_rules_insert_own"
on public.business_tax_category_rules
for insert
with check (
  exists (
    select 1 from public.business b
    where b.id = business_tax_category_rules.business_id
      and b.owner_id = auth.uid()
  )
);

create policy "tax_rules_update_own"
on public.business_tax_category_rules
for update
using (
  exists (
    select 1 from public.business b
    where b.id = business_tax_category_rules.business_id
      and b.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.business b
    where b.id = business_tax_category_rules.business_id
      and b.owner_id = auth.uid()
  )
);

create policy "tax_rules_delete_own"
on public.business_tax_category_rules
for delete
using (
  exists (
    select 1 from public.business b
    where b.id = business_tax_category_rules.business_id
      and b.owner_id = auth.uid()
  )
);


