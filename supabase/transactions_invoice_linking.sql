-- Ensure invoice-linked transactions can be created and queried.
-- Safe to run multiple times.

-- 1) Link transactions to invoices (idempotent upsert key).
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

create unique index if not exists transactions_business_invoice_id_uniq
  on public.transactions (business_id, invoice_id)
  where invoice_id is not null;

-- 2) Optional provenance
alter table public.transactions
add column if not exists source text;

-- 3) Customer name (used for revenue rows; avoids constraint failures in some DBs).
alter table public.transactions
add column if not exists customer_name text;

update public.transactions
set customer_name = 'Unknown Customer (Needs Review)'
where amount > 0
  and (customer_name is null or length(btrim(customer_name)) = 0);

-- 4) Ensure RLS is enabled and at least a select policy exists (core_rls.sql usually covers this).
alter table if exists public.transactions enable row level security;

drop policy if exists "transactions_select_own" on public.transactions;
create policy "transactions_select_own"
  on public.transactions
  for select
  using (
    exists (
      select 1
      from public.business b
      where b.id = transactions.business_id
        and b.owner_id = auth.uid()
    )
  );


