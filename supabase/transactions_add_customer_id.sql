-- Add customer_id to transactions and link to public.customers.
-- We keep customer_name for backwards compatibility / CSV imports, but prefer customer_id moving forward.

alter table public.transactions
add column if not exists customer_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_customer_id_fkey'
  ) then
    alter table public.transactions
      add constraint transactions_customer_id_fkey
      foreign key (customer_id) references public.customers(id)
      on delete set null;
  end if;
end $$;

create index if not exists transactions_business_customer_id_date_idx
  on public.transactions (business_id, customer_id, date);


