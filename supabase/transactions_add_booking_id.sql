-- Link transactions to bookings (optional, but useful for reporting/traceability).
-- Stored as text to tolerate booking.id being uuid or bigint across deployments.
-- Safe to run multiple times.

alter table public.transactions
add column if not exists booking_id text;

create index if not exists transactions_business_booking_id_idx
  on public.transactions (business_id, booking_id);

create unique index if not exists transactions_business_booking_id_uniq
  on public.transactions (business_id, booking_id)
  where booking_id is not null;


