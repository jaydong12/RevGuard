-- One-time cleanup for legacy data:
-- Normalize bookings.price_cents to always be cents (integer).
--
-- If you previously stored dollars (e.g. 50 for $50.00) in price_cents, this will convert it to cents (5000).
-- Heuristic: if 0 <= price_cents < 1000, treat it as dollars and multiply by 100.
-- (Adjust threshold if you routinely charge <$10.)

update public.bookings
set price_cents = price_cents * 100
where price_cents is not null
  and price_cents >= 0
  and price_cents < 1000;


