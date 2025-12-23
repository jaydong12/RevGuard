-- Ensure DELETE RLS policy exists for public.customers.
-- Same rule as insert/update: only if the customer's business belongs to auth.uid().
-- Safe to re-run.

alter table if exists public.customers enable row level security;

drop policy if exists "customers_delete_own" on public.customers;

create policy "customers_delete_own"
  on public.customers
  for delete
  using (
    exists (
      select 1
      from public.business b
      where b.id = customers.business_id
        and b.owner_id = auth.uid()
    )
  );


