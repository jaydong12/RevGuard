-- Minimal subscription record (app-level) for RevGuard Pro.
-- This is NOT Stripe. It’s a simple row that lets the app gate access and show plan state.

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'revguard_pro',
  status text not null default 'active',
  price_cents integer not null default 9900,
  intro_price_cents integer not null default 6900,
  intro_months integer not null default 2,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'subscriptions_updated_at_trg'
  ) then
    create or replace function public.set_updated_at()
    returns trigger
    language plpgsql
    as $fn$
    begin
      new.updated_at := now();
      return new;
    end
    $fn$;

    create trigger subscriptions_updated_at_trg
      before update on public.subscriptions
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.subscriptions enable row level security;

create policy "subscriptions_select_own"
  on public.subscriptions
  for select
  using (auth.uid() = user_id);

create policy "subscriptions_upsert_own"
  on public.subscriptions
  for insert
  with check (auth.uid() = user_id);

create policy "subscriptions_update_own"
  on public.subscriptions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


