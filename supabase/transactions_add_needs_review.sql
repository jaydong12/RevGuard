-- Add a simple flag for transactions that require human review.
-- Used to mark rows where amount is missing (NULL) so the UI can surface them.
-- Safe to re-run.

alter table if exists public.transactions
  add column if not exists needs_review boolean not null default false;

-- Backfill: any rows with missing amounts should be reviewed.
update public.transactions
set needs_review = true
where amount is null;

notify pgrst, 'reload schema';


