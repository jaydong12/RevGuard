-- DB-driven sync: when an invoice is marked paid, upsert a linked income transaction.
-- When invoice is changed away from paid, delete that transaction.
-- Safe to run multiple times.

-- Ensure columns exist for linking + amount snapshot.
alter table public.transactions
add column if not exists invoice_id bigint;

-- Some parts of the app/SQL expect a "type" column (income/expense). Add it if missing.
alter table public.transactions
add column if not exists type text not null default 'income';

alter table public.transactions
add column if not exists amount_cents integer;

alter table public.transactions
add column if not exists source text;

alter table public.transactions
add column if not exists customer_name text;

-- If duplicates already exist for (business_id, invoice_id), remove extras before creating the unique index.
with d as (
  select
    id,
    row_number() over (partition by business_id, invoice_id order by id desc) as rn
  from public.transactions
  where invoice_id is not null
)
delete from public.transactions t
using d
where t.id = d.id
  and d.rn > 1;

-- Prevent duplicates (idempotent upsert key).
drop index if exists public.transactions_business_invoice_id_uniq;
create unique index if not exists transactions_business_invoice_id_uniq
  on public.transactions (business_id, invoice_id);

-- Function: upsert/delete on invoice status transitions.
create or replace function public.sync_invoice_paid_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cents integer;
  v_desc text;
  v_tx_id bigint;
begin
  -- If invoice is being moved away from paid, remove the linked transaction.
  if (tg_op = 'UPDATE' and coalesce(old.status,'') = 'paid' and coalesce(new.status,'') <> 'paid') then
    delete from public.transactions
      where business_id = new.business_id
        and invoice_id = new.id;
    -- Keep invoices.transaction_id aligned (AFTER trigger can't mutate NEW reliably).
    update public.invoices
      set transaction_id = null
      where business_id = new.business_id
        and id = new.id;
    return new;
  end if;

  -- Only act when invoice is (or becomes) paid.
  if (coalesce(new.status,'') <> 'paid') then
    return new;
  end if;

  -- IMPORTANT: For invoice→transaction mapping, do NOT use invoices.total or invoices.client_name.
  -- Use booking snapshot fields:
  -- - amount_cents = bookings.price_cents
  -- - description = services.name
  -- Primary join path (required by product):
  --   invoices i -> bookings b via b.invoice_id = i.id -> services s via s.id=b.service_id
  select
    coalesce(b.price_cents, 0) as price_cents,
    s.name as service_name
  into v_cents, v_desc
  from public.bookings b
  left join public.services s on s.id = b.service_id
  where b.business_id = new.business_id
    and b.invoice_id = new.id
  order by b.id desc
  limit 1;

  -- Safety fallback: if booking.invoice_id wasn't linked yet at invoice insert time, use invoices.booking_id.
  if (v_desc is null and new.booking_id is not null) then
    select
      coalesce(b.price_cents, 0) as price_cents,
      s.name as service_name
    into v_cents, v_desc
    from public.bookings b
    left join public.services s on s.id = b.service_id
    where b.business_id = new.business_id
      and b.id = new.booking_id
    limit 1;
  end if;

  -- Upsert transaction. Use positive amount for income.
  insert into public.transactions (
    business_id,
    invoice_id,
    type,
    amount_cents,
    date,
    description,
    category,
    amount,
    source,
    customer_name
  ) values (
    new.business_id,
    new.id,
    'income',
    v_cents,
    new.issue_date,
    v_desc,
    'Services',
    (v_cents::numeric / 100.0),
    'invoice',
    coalesce(nullif(btrim(new.client_name),''), 'Unknown Customer (Needs Review)')
  )
  on conflict (business_id, invoice_id)
  do update set
    amount_cents = excluded.amount_cents,
    date = excluded.date,
    description = excluded.description,
    category = excluded.category,
    amount = excluded.amount,
    source = excluded.source,
    customer_name = excluded.customer_name
  returning id into v_tx_id;

  -- Keep invoices.transaction_id aligned.
  update public.invoices
    set transaction_id = v_tx_id
    where business_id = new.business_id
      and id = new.id;
  return new;
end;
$$;

drop trigger if exists invoices_sync_paid_tx_trg on public.invoices;
create trigger invoices_sync_paid_tx_trg
  after insert or update of status, total, subtotal, issue_date, client_name on public.invoices
  for each row
  execute function public.sync_invoice_paid_transaction();

-- One-time backfill: create missing transactions for existing paid invoices.
-- Idempotent due to unique index + ON CONFLICT.
with paid as (
  select
    i.id as invoice_id,
    i.business_id,
    i.issue_date,
    i.client_name,
    i.booking_id
  from public.invoices i
  where coalesce(i.status,'') = 'paid'
),
insert into public.transactions (
  business_id,
  invoice_id,
  type,
  amount_cents,
  date,
  description,
  category,
  amount,
  source,
  customer_name
)
select
  p.business_id,
  p.invoice_id,
  'income' as type,
  coalesce(b.price_cents, 0) as amount_cents,
  p.issue_date as date,
  s.name as description,
  'Services' as category,
  (coalesce(b.price_cents, 0)::numeric / 100.0) as amount,
  'invoice' as source,
  coalesce(nullif(btrim(p.client_name),''), 'Unknown Customer (Needs Review)') as customer_name
from paid p
left join public.bookings b
  on b.business_id = p.business_id
 and (
   b.invoice_id = p.invoice_id
   or (p.booking_id is not null and b.id = p.booking_id)
 )
left join public.services s on s.id = b.service_id
on conflict (business_id, invoice_id)
do update set
  type = excluded.type,
  amount_cents = excluded.amount_cents,
  date = excluded.date,
  description = excluded.description,
  category = excluded.category,
  amount = excluded.amount,
  source = excluded.source,
  customer_name = excluded.customer_name;

-- Backfill UPDATE: rewrite ALL invoice-linked transactions using the join path:
-- invoices i -> bookings b via b.invoice_id=i.id -> services s via s.id=b.service_id
update public.transactions t
set
  type = 'income',
  category = 'Services',
  date = i.issue_date,
  amount_cents = coalesce(b.price_cents, 0),
  amount = (coalesce(b.price_cents, 0)::numeric / 100.0),
  description = s.name
from public.invoices i
left join public.bookings b
  on b.business_id = i.business_id
 and b.invoice_id = i.id
left join public.services s on s.id = b.service_id
where t.invoice_id is not null
  and t.business_id = i.business_id
  and t.invoice_id = i.id;


