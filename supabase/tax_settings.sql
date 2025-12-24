-- Tax settings (per business) used by /api/tax-report + Tax Summary UI.
-- Run in Supabase SQL editor.

create table if not exists public.tax_settings (
  business_id uuid primary key references public.business(id) on delete cascade,
  entity_type text,
  filing_status text,
  -- stored as decimal (e.g. 0.05 = 5%). nullable means "not set".
  state_rate numeric,
  include_self_employment boolean not null default true,
  updated_at timestamptz not null default now()
);

create or replace function public.set_tax_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_tax_settings_updated_at on public.tax_settings;
create trigger trg_tax_settings_updated_at
before update on public.tax_settings
for each row execute function public.set_tax_settings_updated_at();

alter table public.tax_settings enable row level security;

drop policy if exists "tax_settings_select_own" on public.tax_settings;
drop policy if exists "tax_settings_insert_own" on public.tax_settings;
drop policy if exists "tax_settings_update_own" on public.tax_settings;
drop policy if exists "tax_settings_delete_own" on public.tax_settings;

create policy "tax_settings_select_own"
on public.tax_settings
for select
using (
  exists (
    select 1 from public.business b
    where b.id = tax_settings.business_id
      and b.owner_id = auth.uid()
  )
);

create policy "tax_settings_insert_own"
on public.tax_settings
for insert
with check (
  exists (
    select 1 from public.business b
    where b.id = tax_settings.business_id
      and b.owner_id = auth.uid()
  )
);

create policy "tax_settings_update_own"
on public.tax_settings
for update
using (
  exists (
    select 1 from public.business b
    where b.id = tax_settings.business_id
      and b.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.business b
    where b.id = tax_settings.business_id
      and b.owner_id = auth.uid()
  )
);

create policy "tax_settings_delete_own"
on public.tax_settings
for delete
using (
  exists (
    select 1 from public.business b
    where b.id = tax_settings.business_id
      and b.owner_id = auth.uid()
  )
);

-- Ensure PostgREST schema cache refresh after applying this migration.
notify pgrst, 'reload schema';


