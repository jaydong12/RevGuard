-- Add subscription plan tier to public.business so the app can gate features.
-- Safe defaults:
-- - subscription_status controls whether any paid access is active.
-- - subscription_plan is only meaningful when subscription_status = 'active'.

alter table if exists public.business
  add column if not exists subscription_plan text;

-- Optional: backfill existing active customers to 'pro' (legacy single-plan Pro).
update public.business
  set subscription_plan = coalesce(subscription_plan, 'pro')
where subscription_status = 'active';


