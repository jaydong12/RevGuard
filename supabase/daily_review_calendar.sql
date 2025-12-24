-- Daily review calendar progress per business + day.
-- Tracks 3 boolean checks: transactions, categories, biggest_move.
-- Safe to re-run.

create table if not exists public.daily_review_calendar (
  business_id uuid not null,
  day date not null,
  -- New canonical column name used by the app for upserts / conflict targets.
  -- Kept alongside `day` for backwards compatibility.
  date date,
  transactions boolean not null default false,
  categories boolean not null default false,
  biggest_move boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (business_id, day)
);

-- Backfill / keep `date` aligned for existing rows
alter table public.daily_review_calendar
  alter column date set default null;

update public.daily_review_calendar
  set date = day
  where date is null;

-- Ensure (business_id, date) can be used as an upsert conflict target.
do $$
begin
  begin
    alter table public.daily_review_calendar
      add constraint daily_review_calendar_business_id_date_key unique (business_id, date);
  exception when duplicate_object then
    null;
  end;
end $$;

do $$
begin
  begin
    alter table public.daily_review_calendar
      add constraint daily_review_calendar_business_id_fkey
      foreign key (business_id) references public.business(id)
      on delete cascade;
  exception when duplicate_object then
    null;
  end;
end $$;

-- updated_at trigger
create or replace function public.set_daily_review_calendar_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_daily_review_calendar_updated_at on public.daily_review_calendar;
create trigger set_daily_review_calendar_updated_at
before update on public.daily_review_calendar
for each row execute function public.set_daily_review_calendar_updated_at();

alter table public.daily_review_calendar enable row level security;

drop policy if exists "daily_review_calendar_select_own" on public.daily_review_calendar;
drop policy if exists "daily_review_calendar_insert_own" on public.daily_review_calendar;
drop policy if exists "daily_review_calendar_update_own" on public.daily_review_calendar;
drop policy if exists "daily_review_calendar_delete_own" on public.daily_review_calendar;

-- Owner-scoped via public.business (singular).
create policy "daily_review_calendar_select_own"
  on public.daily_review_calendar
  for select
  using (
    exists (
      select 1
      from public.business b
      where b.id = daily_review_calendar.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "daily_review_calendar_insert_own"
  on public.daily_review_calendar
  for insert
  with check (
    exists (
      select 1
      from public.business b
      where b.id = daily_review_calendar.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "daily_review_calendar_update_own"
  on public.daily_review_calendar
  for update
  using (
    exists (
      select 1
      from public.business b
      where b.id = daily_review_calendar.business_id
        and b.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.business b
      where b.id = daily_review_calendar.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "daily_review_calendar_delete_own"
  on public.daily_review_calendar
  for delete
  using (
    exists (
      select 1
      from public.business b
      where b.id = daily_review_calendar.business_id
        and b.owner_id = auth.uid()
    )
  );


