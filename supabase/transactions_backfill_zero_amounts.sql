-- Fix legacy $0 transactions by deriving amount from linked booking/service when possible.
-- Otherwise, mark them "Needs review" so they show up in the UI.
-- Safe to re-run.

-- Ensure columns exist
alter table if exists public.transactions
  add column if not exists amount_cents integer;

alter table if exists public.transactions
  add column if not exists confidence_score numeric;

alter table if exists public.transactions
  add column if not exists tax_category text not null default 'taxable';

alter table if exists public.transactions
  add column if not exists tax_treatment text not null default 'review';

alter table if exists public.transactions
  add column if not exists tax_reason text;

-- 1) Derive amount from booking snapshot for invoice/booking-linked rows.
with src as (
  select
    t.id,
    t.business_id,
    coalesce(b.price_cents, 0) as cents,
    s.name as service_name
  from public.transactions t
  left join public.bookings b
    on b.business_id = t.business_id
   and (
     (t.invoice_id is not null and b.invoice_id = t.invoice_id)
     or (t.booking_id is not null and b.id::text = t.booking_id)
   )
  left join public.services s on s.id = b.service_id
  where coalesce(t.amount_cents, 0) = 0
    and coalesce(t.amount, 0) = 0
    and (t.invoice_id is not null or t.booking_id is not null)
)
update public.transactions t
set
  amount_cents = src.cents,
  amount = (src.cents::numeric / 100.0),
  category = coalesce(nullif(btrim(t.category), ''), 'Services'),
  description = coalesce(nullif(btrim(t.description), ''), nullif(btrim(src.service_name), ''), t.description)
from src
where t.id = src.id
  and t.business_id = src.business_id
  and src.cents > 0;

-- 2) Mark remaining zero-amount rows as Needs review.
update public.transactions
set
  tax_category = 'uncategorized',
  tax_treatment = 'review',
  confidence_score = least(coalesce(confidence_score, 0.5), 0.25),
  tax_reason = coalesce(nullif(btrim(tax_reason), ''), 'Missing amount (legacy import/manual). Please review.')
where coalesce(amount_cents, 0) = 0
  and coalesce(amount, 0) = 0;

notify pgrst, 'reload schema';


