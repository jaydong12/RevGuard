-- Stripe subscriptions v1
-- Tables:
-- - subscription_plans: plan definitions (source of truth for Stripe price/coupon ids)
-- - subscriptions: per-user Stripe subscription state
-- - stripe_events: webhook dedupe table (event.id)
--
-- NOTE: Run this in Supabase SQL editor.

-- 1) Plan definitions
create table if not exists public.subscription_plans (
  id text primary key, -- e.g. 'starter' | 'growth' | 'pro'
  stripe_price_id text not null,
  stripe_coupon_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscription_plans enable row level security;

-- Allow all authenticated users to read plan definitions (pricing page).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'subscription_plans'
      and policyname = 'subscription_plans_select_authenticated'
  ) then
    create policy subscription_plans_select_authenticated
      on public.subscription_plans
      for select
      to authenticated
      using (true);
  end if;
end $$;

-- 2) Subscription state (per user)
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_id text null references public.subscription_plans(id),
  status text not null default 'inactive', -- Stripe subscription status
  stripe_customer_id text null,
  stripe_subscription_id text null,
  current_period_end timestamptz null,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_stripe_customer_id_idx
  on public.subscriptions (stripe_customer_id);

create index if not exists subscriptions_stripe_subscription_id_idx
  on public.subscriptions (stripe_subscription_id);

alter table public.subscriptions enable row level security;

-- Users can read their own subscription row.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'subscriptions'
      and policyname = 'subscriptions_select_own'
  ) then
    create policy subscriptions_select_own
      on public.subscriptions
      for select
      to authenticated
      using (auth.uid() = user_id);
  end if;
end $$;

-- Writes to subscriptions are performed via server using service role (webhook/checkout).
-- Keep RLS tight: do NOT allow client inserts/updates.

-- 3) Webhook dedupe
create table if not exists public.stripe_events (
  id text primary key, -- Stripe event id (evt_*)
  type text not null,
  created_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;

-- No client access required.

-- Optional: updated_at trigger helper (only if you already have a generic trigger function).

