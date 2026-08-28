-- ---------------------------------------------------------------------------
-- Who processed the transfer.
--
-- "Items Released by" on the printed form was filled with the custodian the
-- asset came from. That is the person who had it, not the person who recorded
-- the movement, and the box asks for the second.
--
-- The name is stamped onto the row when the transfer is written, rather than
-- looked up when the form is printed, for two reasons: a user may only read
-- their own profile, so a reprint by a colleague would otherwise show nothing;
-- and a printed document should say who processed it at the time, whatever
-- happens to that account afterwards.
-- ---------------------------------------------------------------------------

alter table public.asset_transfers
  add column if not exists recorded_by_name text;

comment on column public.asset_transfers.recorded_by_name is
  'Display name of the account that recorded the transfer, stamped at insert. Printed as "Items Released by".';

create or replace function public.set_transfer_recorder()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.recorded_by_name is null or btrim(new.recorded_by_name) = '' then
    -- definer rights on purpose: a user may read only their own profile row
    select p.full_name into new.recorded_by_name
    from public.user_profiles p
    where p.user_id = coalesce(new.created_by, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists asset_transfers_set_recorder on public.asset_transfers;
create trigger asset_transfers_set_recorder
  before insert on public.asset_transfers
  for each row execute function public.set_transfer_recorder();

-- Movements already on the register keep their history: the name is filled in
-- from whoever created the row, where that account still has a profile.
update public.asset_transfers t
set recorded_by_name = p.full_name
from public.user_profiles p
where p.user_id = t.created_by
  and (t.recorded_by_name is null or btrim(t.recorded_by_name) = '');
