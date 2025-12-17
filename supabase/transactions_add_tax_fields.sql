-- Add tax fields to transactions (do NOT represent taxes as transactions).
-- tax_category: classification used by tax reports (default: 'taxable').
--   Common values we support in-app:
--   - 'taxable' | 'non_taxable' (income classification)
--   - 'deductible' | 'non_deductible' | 'partial_deductible' | 'capitalized' | 'review' (expense treatment)
-- tax_status: whether this transaction has already been included in a tax filing/payment cycle.
-- tax_year: the tax year the transaction belongs to (derived from date; kept in sync by trigger).

alter table public.transactions
add column if not exists tax_category text not null default 'taxable';

alter table public.transactions
add column if not exists tax_status text not null default 'not_taxed';

alter table public.transactions
add column if not exists tax_year integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_tax_status_check'
  ) then
    alter table public.transactions
      add constraint transactions_tax_status_check
      check (tax_status in ('not_taxed', 'taxed'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'transactions_tax_category_check'
  ) then
    alter table public.transactions
      add constraint transactions_tax_category_check
      check (
        tax_category in (
          'taxable',
          'non_taxable',
          'deductible',
          'non_deductible',
          'partial_deductible',
          'capitalized',
          'review'
        )
      );
  end if;
end $$;

-- Backfill existing rows (safe if already populated).
update public.transactions
set
  tax_category = coalesce(tax_category, 'taxable'),
  tax_status = coalesce(tax_status, 'not_taxed')
where tax_category is null or tax_status is null;

-- Backfill tax_year from date (handles date or text that can be cast to date).
update public.transactions
set tax_year = extract(year from (date::date))::int
where tax_year is null and date is not null;

-- Keep tax_year in sync when date changes.
create or replace function public.transactions_set_tax_year()
returns trigger
language plpgsql
as $$
begin
  if new.date is null then
    new.tax_year := null;
  else
    new.tax_year := extract(year from (new.date::date))::int;
  end if;
  return new;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'transactions_set_tax_year_trg'
  ) then
    create trigger transactions_set_tax_year_trg
      before insert or update of date on public.transactions
      for each row execute function public.transactions_set_tax_year();
  end if;
end $$;

create index if not exists transactions_business_tax_status_date_idx
  on public.transactions (business_id, tax_status, date);

create index if not exists transactions_business_tax_year_date_idx
  on public.transactions (business_id, tax_year, date);


