-- Backfill missing invoice totals for booking-linked invoices.
-- This is needed so invoice→transaction sync (amount_cents = round(i.total*100)) produces non-zero amounts.
--
-- Strategy:
-- - Join invoices -> bookings by invoices.booking_id (preferred).
-- - Fall back to bookings.invoice_id = invoices.id (legacy linkage).
-- - Use bookings.price_cents (preferred), fallback services.price_cents.
-- - Only overwrite when invoice subtotal/total are 0.

with linked as (
  select
    i.id as invoice_id,
    i.business_id,
    b.id as booking_id,
    coalesce(nullif(b.price_cents, 0), nullif(s.price_cents, 0), 0) as price_cents
  from public.invoices i
  left join public.bookings b
    on b.business_id = i.business_id
   and (
     (i.booking_id is not null and b.id = i.booking_id)
     or (b.invoice_id = i.id)
   )
  left join public.services s on s.id = b.service_id
  where (coalesce(i.total, 0) = 0 or coalesce(i.subtotal, 0) = 0)
)
update public.invoices i
set
  subtotal = case
    when coalesce(i.subtotal, 0) = 0 then round((linked.price_cents::numeric / 100.0), 2)
    else i.subtotal
  end,
  total = case
    when coalesce(i.total, 0) = 0 then round((linked.price_cents::numeric / 100.0), 2)
    else i.total
  end
from linked
where i.id = linked.invoice_id
  and i.business_id = linked.business_id;


