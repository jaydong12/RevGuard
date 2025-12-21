-- Smart invoices main table
create table if not exists public.invoices (
  id bigserial primary key,
  business_id uuid references public.business(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  invoice_number text not null,
  client_name text not null,
  issue_date date not null,
  due_date date not null,
  status text not null check (status in ('draft','sent','paid','overdue')),
  subtotal numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  notes text,
  transaction_id bigint references public.transactions(id),
  created_at timestamptz not null default now()
);

-- Invoice line items
create table if not exists public.invoice_items (
  id bigserial primary key,
  invoice_id bigint not null references public.invoices(id) on delete cascade,
  description text not null,
  quantity numeric(12,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  line_total numeric(12,2) generated always as (quantity * unit_price) stored
);

-- Backfill safety: ensure user_id exists even if invoices pre-dated this file.
alter table if exists public.invoices
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Enable RLS + policies (match frontend filters).
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;

drop policy if exists "invoices_select_own" on public.invoices;
drop policy if exists "invoices_insert_own" on public.invoices;
drop policy if exists "invoices_update_own" on public.invoices;
drop policy if exists "invoices_delete_own" on public.invoices;

create policy "invoices_select_own"
  on public.invoices
  for select
  using (
    exists (
      select 1
      from public.business b
      where b.id = invoices.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "invoices_insert_own"
  on public.invoices
  for insert
  with check (
    exists (
      select 1
      from public.business b
      where b.id = invoices.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "invoices_update_own"
  on public.invoices
  for update
  using (
    exists (
      select 1
      from public.business b
      where b.id = invoices.business_id
        and b.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.business b
      where b.id = invoices.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "invoices_delete_own"
  on public.invoices
  for delete
  using (
    exists (
      select 1
      from public.business b
      where b.id = invoices.business_id
        and b.owner_id = auth.uid()
    )
  );

-- If client forgets to pass business_id, set it to the user's first business (auth.uid()).
create or replace function public.invoices_set_business_id_default()
returns trigger as $$
begin
  if new.business_id is null then
    select b.id
      into new.business_id
    from public.business b
    where b.owner_id = auth.uid()
    order by b.created_at asc
    limit 1;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists invoices_set_business_id_default on public.invoices;
create trigger invoices_set_business_id_default
before insert on public.invoices
for each row execute procedure public.invoices_set_business_id_default();

drop policy if exists "invoice_items_select_via_invoice" on public.invoice_items;
drop policy if exists "invoice_items_insert_via_invoice" on public.invoice_items;
drop policy if exists "invoice_items_update_via_invoice" on public.invoice_items;
drop policy if exists "invoice_items_delete_via_invoice" on public.invoice_items;

create policy "invoice_items_select_via_invoice"
  on public.invoice_items
  for select
  using (
    exists (
      select 1
      from public.invoices i
      join public.business b on b.id = i.business_id
      where i.id = invoice_items.invoice_id
        and b.owner_id = auth.uid()
    )
  );

create policy "invoice_items_insert_via_invoice"
  on public.invoice_items
  for insert
  with check (
    exists (
      select 1
      from public.invoices i
      join public.business b on b.id = i.business_id
      where i.id = invoice_items.invoice_id
        and b.owner_id = auth.uid()
    )
  );

create policy "invoice_items_update_via_invoice"
  on public.invoice_items
  for update
  using (
    exists (
      select 1
      from public.invoices i
      join public.business b on b.id = i.business_id
      where i.id = invoice_items.invoice_id
        and b.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.invoices i
      join public.business b on b.id = i.business_id
      where i.id = invoice_items.invoice_id
        and b.owner_id = auth.uid()
    )
  );

create policy "invoice_items_delete_via_invoice"
  on public.invoice_items
  for delete
  using (
    exists (
      select 1
      from public.invoices i
      join public.business b on b.id = i.business_id
      where i.id = invoice_items.invoice_id
        and b.owner_id = auth.uid()
    )
  );

-- NOTE:
-- If your business table is named something else, replace
--   public.business(id)
-- with the correct table + primary key before running this.
--
-- Verify trigger + function exist (run in Supabase SQL editor):
--   select t.tgname, p.proname
--   from pg_trigger t
--   join pg_proc p on p.oid = t.tgfoid
--   where t.tgrelid = 'public.invoices'::regclass
--     and not t.tgisinternal;
--
--   select proname
--   from pg_proc
--   where proname = 'invoices_set_business_id_default';


