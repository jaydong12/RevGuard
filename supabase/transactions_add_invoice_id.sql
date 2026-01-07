-- Link transactions to invoices (1 invoice -> 1 revenue transaction).
-- Safe to run multiple times.

alter table public.transactions
add column if not exists invoice_id bigint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'transactions_invoice_id_fkey'
  ) then
    alter table public.transactions
      add constraint transactions_invoice_id_fkey
      foreign key (invoice_id) references public.invoices(id)
      on delete set null;
  end if;
end $$;

-- Prevent duplicates: one transaction per invoice per business.
create unique index if not exists transactions_business_invoice_id_uniq
  on public.transactions (business_id, invoice_id)
  where invoice_id is not null;


