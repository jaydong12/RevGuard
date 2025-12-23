-- Business Profile fields for public.business
-- Safe to re-run.

alter table if exists public.business
  add column if not exists name text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists website text,
  add column if not exists logo_url text,
  add column if not exists address1 text,
  add column if not exists address2 text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists zip text;


