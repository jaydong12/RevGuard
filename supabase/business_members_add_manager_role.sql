-- Ensure business_members.role supports 'manager' even if the table already existed.
-- Safe to re-run.

do $$
begin
  -- Drop any existing check constraint that enforces old role set.
  begin
    alter table public.business_members drop constraint if exists business_members_role_check;
  exception when undefined_table then
    return;
  end;

  -- Re-add with the expanded role set.
  begin
    alter table public.business_members
      add constraint business_members_role_check
      check (role in ('owner','manager','employee','admin'));
  exception when duplicate_object then
    null;
  end;
end $$;

notify pgrst, 'reload schema';


