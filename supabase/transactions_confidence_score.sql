-- Transaction confidence score (0..1) used for TaxEngine accuracy scoring.
-- Run in Supabase SQL editor.

alter table public.transactions
  add column if not exists confidence_score numeric;

-- Backfill nulls to a neutral default so accuracy score works immediately.
update public.transactions
set confidence_score = coalesce(confidence_score, 0.5)
where confidence_score is null;

-- Optional: keep values sane (0..1). Adds a check constraint if missing.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_confidence_score_check'
  ) then
    alter table public.transactions
      add constraint transactions_confidence_score_check
      check (confidence_score >= 0 and confidence_score <= 1);
  end if;
end $$;

create index if not exists transactions_business_confidence_idx
  on public.transactions (business_id, confidence_score);

-- Ensure PostgREST schema cache refresh after applying this migration.
notify pgrst, 'reload schema';


