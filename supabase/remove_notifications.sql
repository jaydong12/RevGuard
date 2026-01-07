-- Remove the notifications system (DB cleanup).
-- Safe to re-run.
--
-- NOTE: Only run this if you previously applied the notifications migrations.
-- This drops tables, triggers, and helper functions related to notifications + activity tracking.

-- Triggers / functions
drop trigger if exists time_entries_notify_worker_clock_in_trg on public.time_entries;
drop function if exists public.notify_worker_clock_in();

drop trigger if exists user_activity_set_updated_at_trg on public.user_activity;
drop function if exists public.user_activity_set_updated_at();

-- Tables
drop table if exists public.notifications;
drop table if exists public.user_activity;

notify pgrst, 'reload schema';


