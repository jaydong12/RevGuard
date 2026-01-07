-- Snapshot booked amount onto the booking row (so reports don't depend on joins).
-- Safe to run multiple times.

alter table public.bookings
add column if not exists price_cents integer not null default 0;

-- Backfill: copy from service price when possible (admin migration context can join).
update public.bookings b
set price_cents = coalesce(s.price_cents, 0)
from public.services s
where b.service_id = s.id
  and b.business_id = s.business_id
  and (b.price_cents is null or b.price_cents = 0);

-- Helpful index for revenue rollups.
create index if not exists bookings_business_status_start_idx
  on public.bookings (business_id, status, start_at);


