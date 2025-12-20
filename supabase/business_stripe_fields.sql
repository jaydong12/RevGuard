-- Stripe billing fields on public.business
-- Attach Stripe entities to the business (NOT email) to prevent cross-account leaks.

alter table if exists public.business
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text not null default 'inactive',
  add column if not exists current_period_end timestamptz;

-- Unique IDs (Stripe IDs). Postgres unique constraints allow multiple NULLs.
create unique index if not exists business_stripe_customer_id_unique
  on public.business (stripe_customer_id);

create unique index if not exists business_stripe_subscription_id_unique
  on public.business (stripe_subscription_id);


