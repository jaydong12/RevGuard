-- Onboarding v1
-- - Adds onboarding fields to profiles + business
-- - Adds business.preferences JSONB for onboarding toggles
-- Safe to re-run.

-- -------------------------
-- public.profiles
-- -------------------------
alter table if exists public.profiles
  add column if not exists role text,
  add column if not exists onboarding_step integer not null default 0,
  add column if not exists onboarding_complete boolean not null default false;

-- -------------------------
-- public.business (singular)
-- -------------------------
alter table if exists public.business
  add column if not exists industry text,
  add column if not exists timezone text,
  add column if not exists location text,
  add column if not exists preferences jsonb not null default '{}'::jsonb,
  add column if not exists onboarding_step integer not null default 0,
  add column if not exists onboarding_complete boolean not null default false;

notify pgrst, 'reload schema';


