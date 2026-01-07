-- Backfill transactions.amount_cents from transactions.amount (dollars) for legacy/imported rows.
-- This fixes cases where amount_cents exists with default 0 but historical inserts only set amount.
-- Safe to re-run.

alter table if exists public.transactions
  add column if not exists amount_cents integer;

update public.transactions
set amount_cents = round(coalesce(amount, 0) * 100)::int
where (amount_cents is null or amount_cents = 0)
  and amount is not null
  and amount <> 0;

notify pgrst, 'reload schema';


