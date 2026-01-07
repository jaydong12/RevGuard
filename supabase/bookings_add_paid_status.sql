-- Allow bookings.status = 'paid' (and keep it schema-safe across DBs).
-- Safe to run multiple times.

do $$
declare
  r record;
begin
  -- Drop any existing CHECK constraints that mention "status" on public.bookings.
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.bookings'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.bookings drop constraint if exists %I', r.conname);
  end loop;

  -- Add a deterministic constraint name with the expanded set.
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_status_check'
  ) then
    alter table public.bookings
      add constraint bookings_status_check
      check (status in ('pending','confirmed','cancelled','completed','paid'));
  end if;
end $$;


