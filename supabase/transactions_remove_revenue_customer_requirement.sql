-- Allow revenue rows (amount > 0) with NULL customer_id during import.
-- This supports importing bank/processor exports that don't include customer identity.

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'transactions_customer_required_for_revenue'
  ) then
    alter table public.transactions
      drop constraint transactions_customer_required_for_revenue;
  end if;
end $$;


