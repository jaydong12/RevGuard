-- Add customer_name to transactions and enforce it for revenue (amount > 0).
-- Safe for existing data: we backfill missing customer_name on positive rows
-- before adding the constraint.

alter table public.transactions
add column if not exists customer_name text;

-- Backfill existing revenue rows so the constraint can be enabled safely.
update public.transactions
set customer_name = 'Unknown Customer (Needs Review)'
where amount > 0
  and (customer_name is null or length(btrim(customer_name)) = 0);

-- Require customer_name for revenue entries (amount > 0).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'transactions_customer_name_required_for_revenue'
  ) then
    alter table public.transactions
      add constraint transactions_customer_name_required_for_revenue
      check (amount <= 0 or (customer_name is not null and length(btrim(customer_name)) > 0));
  end if;
end $$;

-- Helpful index for reports.
create index if not exists transactions_business_customer_date_idx
  on public.transactions (business_id, customer_name, date);


