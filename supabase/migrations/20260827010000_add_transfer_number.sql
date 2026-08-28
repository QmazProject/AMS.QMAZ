-- Transfer numbers
--
-- Every movement carries a number that is the same for everyone who can see
-- it. That rules out counting on the client: a user scoped to one company
-- cannot see the movements of another, so their count would start again at 1
-- and two people would read different numbers off the same sheet.
--
-- The number therefore comes from a sequence in the database, assigned once
-- when the movement is recorded and never recomputed.
--
-- Registration rows live in this table too (an asset's first appearance, with
-- nothing to move from). Those are not transfers and are deliberately left
-- unnumbered, so the numbering runs 1, 2, 3 across actual movements.

create sequence if not exists public.asset_transfer_number_seq;

alter table public.asset_transfers
  add column if not exists transfer_number bigint;

comment on column public.asset_transfers.transfer_number is
  'Register-wide running number for an actual movement, shown as TR NO and printed on the transfer form. Null on registration rows, which are not transfers.';

-- Existing movements are numbered in the order they happened, so the trail
-- reads the same after this migration as it did before it.
with ordered as (
  select id, row_number() over (order by effective_on, created_at, id) as n
  from public.asset_transfers
  where from_address is not null
     or from_custodian is not null
     or from_project_location_id is not null
)
update public.asset_transfers as t
set transfer_number = ordered.n
from ordered
where ordered.id = t.id
  and t.transfer_number is null;

-- and the sequence carries on from there
select setval(
  'public.asset_transfer_number_seq',
  coalesce((select max(transfer_number) from public.asset_transfers), 0) + 1,
  false
);

create unique index if not exists asset_transfers_number_uq
  on public.asset_transfers (transfer_number)
  where transfer_number is not null;

create or replace function public.set_asset_transfer_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.transfer_number is null
     and (new.from_address is not null
          or new.from_custodian is not null
          or new.from_project_location_id is not null) then
    new.transfer_number := nextval('public.asset_transfer_number_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists asset_transfers_set_number on public.asset_transfers;
create trigger asset_transfers_set_number
before insert on public.asset_transfers
for each row execute function public.set_asset_transfer_number();
