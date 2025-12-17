-- One row per business: settings for profile, taxes, invoicing, categories/rules, etc.
-- Includes RLS with an auth-based owner check, plus a safe local/dev fallback when no auth session exists.

create table if not exists public.business_settings (
  business_id uuid primary key references public.business(id) on delete cascade,
  owner_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Business profile
  business_name text,
  phone text,
  email text,
  address text,
  logo_path text,
  default_currency text not null default 'USD',
  -- Compatibility/minimal fields (requested): currency, tax_rate, invoice_terms.
  -- We keep the richer columns too, but ensure these exist for simpler clients.
  currency text not null default 'USD',
  timezone text not null default 'America/New_York',

  -- Tax settings
  entity_type text not null default 'LLC',
  filing_state text,
  tax_year_start_month integer not null default 1,
  estimated_tax_rate numeric not null default 0.29,
  tax_rate numeric not null default 0.29,
  show_tax_widgets boolean not null default true,

  -- Invoice settings
  payment_terms_days integer not null default 30,
  invoice_terms integer not null default 30,
  late_fee_percent numeric not null default 0,
  invoice_footer text,
  invoice_default_note text,
  next_invoice_number integer not null default 1,
  brand_color text not null default '#10b981',

  -- Categories & rules
  categories jsonb not null default '[]'::jsonb,
  auto_categorize_rules jsonb not null default '[]'::jsonb
);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'business_settings_updated_at_trg'
  ) then
    create or replace function public.set_updated_at()
    returns trigger
    language plpgsql
    as $fn$
    begin
      new.updated_at := now();
      return new;
    end
    $fn$;

    create trigger business_settings_updated_at_trg
      before update on public.business_settings
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.business_settings enable row level security;

-- Read/write only for the business owner.
-- Fallback for local/demo environments: if owner_id is NULL and there's no auth session, allow access.
create policy "business_settings_select_owner"
  on public.business_settings
  for select
  using (
    owner_id = auth.uid()
    or (owner_id is null and auth.uid() is null)
  );

create policy "business_settings_insert_owner"
  on public.business_settings
  for insert
  with check (
    owner_id = auth.uid()
    or (owner_id is null and auth.uid() is null)
  );

create policy "business_settings_update_owner"
  on public.business_settings
  for update
  using (
    owner_id = auth.uid()
    or (owner_id is null and auth.uid() is null)
  )
  with check (
    owner_id = auth.uid()
    or (owner_id is null and auth.uid() is null)
  );

-- Storage bucket for business logos (public read; writes governed by storage policies in Supabase).
insert into storage.buckets (id, name, public)
values ('business-logos', 'business-logos', true)
on conflict (id) do nothing;


