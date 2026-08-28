-- ---------------------------------------------------------------------------
-- What an asset is, as opposed to which one it is.
--
-- The register already holds every number that identifies a particular
-- machine. Brand and model say what kind of machine it is, which is what
-- someone reaches for when buying a spare, comparing two of them, or looking
-- for the manual. Both are optional: a lot of small equipment carries neither.
--
-- They are register detail, not identification, so nothing is unique about
-- them and they are deliberately kept off the printed transfer form.
-- ---------------------------------------------------------------------------

alter table public.assets
  add column if not exists brand text,
  add column if not exists model text;

comment on column public.assets.brand is
  'Who made it — Komatsu, Makita, Dell. Optional, and never an identifier.';
comment on column public.assets.model is
  'Which model it is — PC200-8. Optional, and never an identifier.';

-- Every other detail on an asset leaves a line in its history when it changes;
-- these two now do the same.
create or replace function public.record_asset_details_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if row(
    old.asset_number, old.asset_code, old.company_id, old.category_id, old.name,
    old.brand, old.model,
    old.serial_number, old.engine_number, old.plate_number, old.mv_file_number,
    old.conduction_sticker, old.body_number, old.acquired_on,
    old.acquisition_cost, old.notes
  ) is distinct from row(
    new.asset_number, new.asset_code, new.company_id, new.category_id, new.name,
    new.brand, new.model,
    new.serial_number, new.engine_number, new.plate_number, new.mv_file_number,
    new.conduction_sticker, new.body_number, new.acquired_on,
    new.acquisition_cost, new.notes
  ) then
    insert into public.asset_activity (
      asset_id, event_type, event_date, title, actor_id
    ) values (
      new.id, 'asset_updated', current_date, 'Asset details updated', auth.uid()
    );
  end if;
  return new;
end;
$$;
