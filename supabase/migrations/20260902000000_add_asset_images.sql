-- ---------------------------------------------------------------------------
-- More than one photograph of the same machine.
--
-- One picture says which excavator this is. It does not say what the dent on
-- the offside door looks like, or what the hour meter read when it was signed
-- for, and those are the pictures somebody takes on a walkaround. So an asset
-- carries a list of images rather than a single slot.
--
-- Order is the whole feature. `position` decides which photograph represents
-- the asset in a list of two hundred, and the one at position 0 is the one the
-- register shows wherever it has room for exactly one. Whoever edits the asset
-- chooses it; nothing here infers it.
--
-- assets.photo_path is deliberately kept, pointing at that first image. Three
-- places in the app already read it to draw a thumbnail, the details-changed
-- trigger already watches it so a change of cover lands in the asset's
-- history, and neither has to learn about this table to keep working.
--
-- The bucket is the existing public asset-photos: the objects are the same
-- kind of thing they always were, so nothing is created or re-policied here.
-- ---------------------------------------------------------------------------

create table if not exists public.asset_images (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  storage_bucket text not null default 'asset-photos',
  storage_object_path text not null,
  -- 0 is the cover. Not unique per asset on purpose: renumbering a list would
  -- otherwise have to dodge its own constraint halfway through the update.
  position integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  removed_at timestamptz,
  removed_by uuid references auth.users(id) on delete set null
);

comment on table public.asset_images is
  'Photographs of an asset, in the order somebody chose. Position 0 is the one shown wherever the register has room for one picture.';
comment on column public.asset_images.position is
  'Display order. The row at 0 is the default, and assets.photo_path points at the same object.';

create unique index if not exists asset_images_path_uq
  on public.asset_images (storage_bucket, storage_object_path);
create index if not exists asset_images_order_idx
  on public.asset_images (asset_id, position)
  where removed_at is null;

create or replace function public.set_asset_image_remover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.removed_at is not null and old.removed_at is null then
    new.removed_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists asset_images_set_remover on public.asset_images;
create trigger asset_images_set_remover
before update on public.asset_images
for each row execute function public.set_asset_image_remover();

-- Every asset that already has a picture keeps it, as its cover.
insert into public.asset_images (asset_id, storage_bucket, storage_object_path, position)
select id, 'asset-photos', photo_path, 0
from public.assets
where photo_path is not null and btrim(photo_path) <> ''
on conflict (storage_bucket, storage_object_path) do nothing;

alter table public.asset_images enable row level security;

-- Seeing an asset's photographs follows seeing the asset; adding one follows
-- being allowed to register or edit one, because that is when they are added.
drop policy if exists asset_images_scoped_read on public.asset_images;
drop policy if exists asset_images_scoped_insert on public.asset_images;
drop policy if exists asset_images_scoped_update on public.asset_images;
create policy asset_images_scoped_read on public.asset_images
for select to authenticated using (
  public.has_asset_permission('asset.view')
  and public.can_access_asset_record(asset_id)
);
create policy asset_images_scoped_insert on public.asset_images
for insert to authenticated with check (
  (public.has_asset_permission('asset.create') or public.has_asset_permission('asset.update'))
  and public.can_access_asset_record(asset_id)
);
create policy asset_images_scoped_update on public.asset_images
for update to authenticated using (
  public.has_asset_permission('asset.update')
  and public.can_access_asset_record(asset_id)
) with check (
  public.has_asset_permission('asset.update')
  and public.can_access_asset_record(asset_id)
);

revoke all on table public.asset_images from anon, authenticated;
grant select, insert, update on table public.asset_images to authenticated;
