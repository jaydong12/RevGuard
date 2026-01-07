-- Link an employee auth user to a worker row using email, without placeholders.
-- This prevents 22P02 (invalid uuid) caused by pasting tokens like <WORKER_ID>.
--
-- Run in Supabase SQL Editor as the project owner.
-- Safe to re-run (idempotent for the same worker/email).

do $$
declare
  v_business_id uuid := 'YOUR_BUSINESS_UUID';
  v_employee_email text := 'employee@example.com';
  v_worker_id bigint := 0; -- set to the real workers.id (bigint)
  v_user_id uuid;
begin
  if v_business_id::text like 'YOUR_%' or v_employee_email like '%@example.com' or v_worker_id <= 0 then
    raise exception 'Set v_business_id, v_employee_email, and v_worker_id to real values before running.';
  end if;

  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = lower(v_employee_email)
  limit 1;

  if v_user_id is null then
    raise exception 'No auth.users row found for email %', v_employee_email;
  end if;

  update public.workers w
  set user_id = v_user_id
  where w.id = v_worker_id
    and w.business_id = v_business_id;

  if not found then
    raise exception 'No worker row matched (business_id %, worker_id %)', v_business_id, v_worker_id;
  end if;

  -- Ensure membership row exists too (role=employee). Uses real UUIDs.
  insert into public.business_members (business_id, user_id, role, worker_id)
  values (v_business_id, v_user_id, 'employee', v_worker_id)
  on conflict (business_id, user_id) do update
    set role = excluded.role,
        worker_id = excluded.worker_id;
end $$;

notify pgrst, 'reload schema';


