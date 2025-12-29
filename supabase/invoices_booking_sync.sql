-- Booking + Smart Invoice sync patches
-- - allow invoices.status = 'void'
-- - add invoices.amount_paid + invoices.balance_due
-- Safe to re-run.

-- Allow invoice cancellation/voiding
do $$
begin
  -- Common generated name from `status text not null check (...)`
  if exists (select 1 from pg_constraint where conname = 'invoices_status_check') then
    alter table public.invoices drop constraint invoices_status_check;
  end if;
exception when undefined_table then
  null;
end $$;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='invoices') then
    -- Re-add constraint with void
    if not exists (select 1 from pg_constraint where conname = 'invoices_status_check') then
      alter table public.invoices
        add constraint invoices_status_check
        check (status in ('draft','sent','paid','overdue','void'));
    end if;
  end if;
end $$;

-- Payment tracking
alter table if exists public.invoices
  add column if not exists amount_paid numeric(12,2) not null default 0;

-- Generated balance due (total - amount_paid)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='invoices' and column_name='balance_due'
  ) then
    null;
  else
    begin
      alter table public.invoices
        add column balance_due numeric(12,2)
        generated always as (greatest(total - amount_paid, 0)) stored;
    exception when feature_not_supported then
      -- If generated columns aren't available, skip. UI will compute from total/amount_paid.
      null;
    end;
  end if;
end $$;

create index if not exists invoices_business_status_due_idx
  on public.invoices (business_id, status, due_date);

notify pgrst, 'reload schema';


