-- Add owner_id to public.business and enforce 1 business per owner.
-- Safe: only applies if the business table exists.

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'business'
  ) then
    alter table public.business
      add column if not exists owner_id uuid;

    -- Optional FK (auth users), only if auth schema exists.
    begin
      alter table public.business
        add constraint business_owner_id_fkey
        foreign key (owner_id) references auth.users(id)
        on delete set null;
    exception when duplicate_object then
      null;
    end;

    -- Enforce 1 business per account when owner_id is set.
    create unique index if not exists business_owner_id_unique
      on public.business (owner_id)
      where owner_id is not null;

    create index if not exists business_owner_created_at_idx
      on public.business (owner_id, created_at);
  end if;
end $$;


