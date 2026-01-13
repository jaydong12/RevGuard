-- Bills recurring rollover trigger
-- Requirement:
-- - Recurring bills should ONLY advance due_date when marked paid (unpaid -> paid).
-- - When a recurring bill is marked paid, advance due_date by the recurrence interval (with recurrence_count),
--   stamp last_paid_at, then reset status back to OPEN for the next cycle.
-- Safe to re-run.

-- Columns (safe if already present)
alter table if exists public.bills
  add column if not exists paid_at timestamptz,
  add column if not exists last_paid_at timestamptz,
  add column if not exists recurrence_count integer not null default 1;

create or replace function public.bills_rollover_on_paid()
returns trigger as $$
declare
  freq text;
  cnt int;
  add_interval interval;
begin
  -- Only act on unpaid -> paid transition.
  if (coalesce(old.status, 'OPEN') <> 'PAID') and (coalesce(new.status, 'OPEN') = 'PAID') then
    new.paid_at = now();
    new.last_paid_at = now();

    if coalesce(new.is_recurring, false) = true then
      freq := lower(coalesce(new.recurrence_frequency, 'monthly'));
      cnt := greatest(coalesce(new.recurrence_count, 1), 1);

      -- Support weekly/monthly/quarterly/yearly. Default to monthly.
      add_interval :=
        case freq
          when 'weekly' then make_interval(days => 7 * cnt)
          when 'yearly' then make_interval(years => cnt)
          when 'quarterly' then make_interval(months => 3 * cnt)
          else make_interval(months => cnt)
        end;

      -- Advance from the prior due_date (NOT from "today"), so overdue bills don't roll until paid.
      new.due_date := (old.due_date + add_interval)::date;

      -- Reset status so the next cycle is unpaid/open.
      new.status := 'OPEN';
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists bills_rollover_on_paid on public.bills;
create trigger bills_rollover_on_paid
before update on public.bills
for each row
execute function public.bills_rollover_on_paid();

notify pgrst, 'reload schema';


