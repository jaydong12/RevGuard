-- Auto-create exactly one business row for each newly created auth user.
-- Trigger: auth.users AFTER INSERT
-- Action: insert into public.business(owner_id, name, subscription_status='inactive')
--         on conflict (owner_id) do nothing

create or replace function public.create_business_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.business (owner_id, name, subscription_status)
  values (new.id, 'My Business', 'inactive')
  on conflict (owner_id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_business_for_new_user_trg on auth.users;

create trigger create_business_for_new_user_trg
after insert on auth.users
for each row
execute function public.create_business_for_new_user();


