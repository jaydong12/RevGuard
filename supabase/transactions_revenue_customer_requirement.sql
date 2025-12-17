-- Update revenue customer requirement:
-- revenue rows (amount > 0) must have either customer_id OR customer_name.
-- This supports the Transactions modal storing only customer_id.

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'transactions_customer_name_required_for_revenue'
  ) then
    alter table public.transactions
      drop constraint transactions_customer_name_required_for_revenue;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'transactions_customer_required_for_revenue'
  ) then
    alter table public.transactions
      add constraint transactions_customer_required_for_revenue
      check (
        amount <= 0
        or (
          customer_id is not null
          or (customer_name is not null and length(btrim(customer_name)) > 0)
        )
      );
  end if;
end $$;


