-- Bookings v1 schema (services, availability, bookings, calendar events)
-- Safe to re-run. Uses business-scoped RLS via public.business.owner_id = auth.uid().

-- -------------------------
-- public.services
-- -------------------------
create table if not exists public.services (
  id bigserial primary key,
  business_id uuid not null references public.business(id) on delete cascade,
  name text not null,
  description text,
  duration_minutes integer not null default 60,
  price_cents integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'services_set_updated_at_trg') then
    create or replace function public.services_set_updated_at()
    returns trigger as $f$
    begin
      new.updated_at := now();
      return new;
    end;
    $f$ language plpgsql;

    create trigger services_set_updated_at_trg
      before update on public.services
      for each row execute function public.services_set_updated_at();
  end if;
end $$;

-- Backward-compat: if an older DB created `price` (numeric dollars), create `price_cents` and backfill.
alter table if exists public.services
  add column if not exists price_cents integer not null default 0;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='services' and column_name='price'
  ) then
    update public.services
    set price_cents = greatest(0, round(coalesce(price, 0) * 100)::int)
    where price_cents is null or price_cents = 0;
  end if;
end $$;

-- Backward-compat: if an older DB created `active`, create `is_active` and backfill.
alter table if exists public.services
  add column if not exists is_active boolean not null default true;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='services' and column_name='active'
  ) then
    update public.services
    set is_active = coalesce(is_active, active)
    where is_active is null;
  end if;
end $$;

create index if not exists services_business_active_idx
  on public.services (business_id, is_active);

alter table public.services enable row level security;
drop policy if exists "services_select_own" on public.services;
drop policy if exists "services_insert_own" on public.services;
drop policy if exists "services_update_own" on public.services;
drop policy if exists "services_delete_own" on public.services;

create policy "services_select_own"
  on public.services
  for select
  using (
    exists (select 1 from public.business b where b.id = services.business_id and b.owner_id = auth.uid())
  );

create policy "services_insert_own"
  on public.services
  for insert
  with check (
    exists (select 1 from public.business b where b.id = services.business_id and b.owner_id = auth.uid())
  );

create policy "services_update_own"
  on public.services
  for update
  using (
    exists (select 1 from public.business b where b.id = services.business_id and b.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.business b where b.id = services.business_id and b.owner_id = auth.uid())
  );

create policy "services_delete_own"
  on public.services
  for delete
  using (
    exists (select 1 from public.business b where b.id = services.business_id and b.owner_id = auth.uid())
  );


-- -------------------------
-- public.availability_rules
-- -------------------------
create table if not exists public.availability_rules (
  id bigserial primary key,
  business_id uuid not null references public.business(id) on delete cascade,
  day_of_week integer not null check (day_of_week >= 0 and day_of_week <= 6), -- 0=Sun..6=Sat
  start_time time not null,
  end_time time not null,
  slot_minutes integer not null default 30,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'availability_rules_set_updated_at_trg') then
    create or replace function public.availability_rules_set_updated_at()
    returns trigger as $f$
    begin
      new.updated_at := now();
      return new;
    end;
    $f$ language plpgsql;

    create trigger availability_rules_set_updated_at_trg
      before update on public.availability_rules
      for each row execute function public.availability_rules_set_updated_at();
  end if;
end $$;

create index if not exists availability_rules_business_dow_idx
  on public.availability_rules (business_id, day_of_week);

alter table public.availability_rules enable row level security;
drop policy if exists "availability_rules_select_own" on public.availability_rules;
drop policy if exists "availability_rules_insert_own" on public.availability_rules;
drop policy if exists "availability_rules_update_own" on public.availability_rules;
drop policy if exists "availability_rules_delete_own" on public.availability_rules;

create policy "availability_rules_select_own"
  on public.availability_rules
  for select
  using (
    exists (select 1 from public.business b where b.id = availability_rules.business_id and b.owner_id = auth.uid())
  );

create policy "availability_rules_insert_own"
  on public.availability_rules
  for insert
  with check (
    exists (select 1 from public.business b where b.id = availability_rules.business_id and b.owner_id = auth.uid())
  );

create policy "availability_rules_update_own"
  on public.availability_rules
  for update
  using (
    exists (select 1 from public.business b where b.id = availability_rules.business_id and b.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.business b where b.id = availability_rules.business_id and b.owner_id = auth.uid())
  );

create policy "availability_rules_delete_own"
  on public.availability_rules
  for delete
  using (
    exists (select 1 from public.business b where b.id = availability_rules.business_id and b.owner_id = auth.uid())
  );


-- -------------------------
-- public.bookings
-- -------------------------
create table if not exists public.bookings (
  id bigserial primary key,
  business_id uuid not null references public.business(id) on delete cascade,
  service_id bigint references public.services(id) on delete set null,
  customer_name text,
  customer_email text,
  customer_phone text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  -- Snapshot service price at time of booking (avoids joins/RLS surprises for reporting)
  price_cents integer not null default 0,
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled','completed')),
  notes text,
  invoice_id bigint references public.invoices(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Backward-compat: if bookings already exists, ensure customer fields exist.
alter table if exists public.bookings
  add column if not exists customer_name text;
alter table if exists public.bookings
  add column if not exists customer_email text;
alter table if exists public.bookings
  add column if not exists customer_phone text;
alter table if exists public.bookings
  add column if not exists price_cents integer not null default 0;

-- Backfill price snapshot from services when possible (type-agnostic join via ::text).
update public.bookings b
set price_cents = coalesce(s.price_cents, 0)
from public.services s
where b.business_id = s.business_id
  and b.service_id::text = s.id::text
  and (b.price_cents is null or b.price_cents = 0);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'bookings_set_updated_at_trg') then
    create or replace function public.bookings_set_updated_at()
    returns trigger as $f$
    begin
      new.updated_at := now();
      return new;
    end;
    $f$ language plpgsql;

    create trigger bookings_set_updated_at_trg
      before update on public.bookings
      for each row execute function public.bookings_set_updated_at();
  end if;
end $$;

create index if not exists bookings_business_start_idx
  on public.bookings (business_id, start_at);

-- Helpful index for global revenue rollups.
create index if not exists bookings_business_status_start_idx
  on public.bookings (business_id, status, start_at);

alter table public.bookings enable row level security;
drop policy if exists "bookings_select_own" on public.bookings;
drop policy if exists "bookings_insert_own" on public.bookings;
drop policy if exists "bookings_update_own" on public.bookings;
drop policy if exists "bookings_delete_own" on public.bookings;

create policy "bookings_select_own"
  on public.bookings
  for select
  using (
    exists (select 1 from public.business b where b.id = bookings.business_id and b.owner_id = auth.uid())
  );

create policy "bookings_insert_own"
  on public.bookings
  for insert
  with check (
    exists (select 1 from public.business b where b.id = bookings.business_id and b.owner_id = auth.uid())
  );

create policy "bookings_update_own"
  on public.bookings
  for update
  using (
    exists (select 1 from public.business b where b.id = bookings.business_id and b.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.business b where b.id = bookings.business_id and b.owner_id = auth.uid())
  );

create policy "bookings_delete_own"
  on public.bookings
  for delete
  using (
    exists (select 1 from public.business b where b.id = bookings.business_id and b.owner_id = auth.uid())
  );


-- -------------------------
-- public.calendar_events
-- -------------------------
create table if not exists public.calendar_events (
  id bigserial primary key,
  business_id uuid not null references public.business(id) on delete cascade,
  booking_id bigint references public.bookings(id) on delete cascade,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Backward-compat: older deployments may have a `timezone` column; remove it if present.
alter table if exists public.calendar_events
  drop column if exists timezone;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'calendar_events_set_updated_at_trg') then
    create or replace function public.calendar_events_set_updated_at()
    returns trigger as $f$
    begin
      new.updated_at := now();
      return new;
    end;
    $f$ language plpgsql;

    create trigger calendar_events_set_updated_at_trg
      before update on public.calendar_events
      for each row execute function public.calendar_events_set_updated_at();
  end if;
end $$;

create index if not exists calendar_events_business_start_idx
  on public.calendar_events (business_id, start_at);

alter table public.calendar_events enable row level security;
drop policy if exists "calendar_events_select_own" on public.calendar_events;
drop policy if exists "calendar_events_insert_own" on public.calendar_events;
drop policy if exists "calendar_events_update_own" on public.calendar_events;
drop policy if exists "calendar_events_delete_own" on public.calendar_events;

create policy "calendar_events_select_own"
  on public.calendar_events
  for select
  using (
    exists (select 1 from public.business b where b.id = calendar_events.business_id and b.owner_id = auth.uid())
  );

create policy "calendar_events_insert_own"
  on public.calendar_events
  for insert
  with check (
    exists (select 1 from public.business b where b.id = calendar_events.business_id and b.owner_id = auth.uid())
  );

create policy "calendar_events_update_own"
  on public.calendar_events
  for update
  using (
    exists (select 1 from public.business b where b.id = calendar_events.business_id and b.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.business b where b.id = calendar_events.business_id and b.owner_id = auth.uid())
  );

create policy "calendar_events_delete_own"
  on public.calendar_events
  for delete
  using (
    exists (select 1 from public.business b where b.id = calendar_events.business_id and b.owner_id = auth.uid())
  );


-- -------------------------
-- Link invoices to bookings
-- -------------------------
alter table public.invoices
  add column if not exists source text not null default 'manual';

alter table public.invoices
  add column if not exists booking_id bigint references public.bookings(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_source_check') then
    alter table public.invoices
      add constraint invoices_source_check
      check (source in ('manual','booking'));
  end if;
end $$;

create index if not exists invoices_business_source_booking_idx
  on public.invoices (business_id, source, booking_id);

-- Ensure PostgREST schema cache refresh after applying this migration.
notify pgrst, 'reload schema';


