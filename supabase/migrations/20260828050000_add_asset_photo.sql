-- ---------------------------------------------------------------------------
-- A photograph of the asset.
--
-- Numbers identify a machine on paper; a picture identifies it in a yard. One
-- photo per asset, taken when it is registered or added later from the edit
-- form, and shown beside the asset's details.
--
-- The bucket is public, like company logos and unlike receipts: a photo of a
-- bulldozer is not a financial record, and a public object means the picture
-- resolves without signing a URL every time a panel opens. The path carries a
-- random uuid, so it cannot be guessed from an asset number, and writing to
-- the bucket still requires an account that may register or edit assets.
-- ---------------------------------------------------------------------------

alter table public.assets
  add column if not exists photo_path text;

comment on column public.assets.photo_path is
  'Object path in the asset-photos bucket. One photo per asset; replacing it deletes the old object.';

-- A photo change belongs in the asset's history with every other detail.
create or replace function public.record_asset_details_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if row(
    old.asset_number, old.asset_code, old.company_id, old.category_id, old.name,
    old.brand, old.model, old.photo_path,
    old.serial_number, old.engine_number, old.plate_number, old.mv_file_number,
    old.conduction_sticker, old.body_number, old.acquired_on,
    old.acquisition_cost, old.notes
  ) is distinct from row(
    new.asset_number, new.asset_code, new.company_id, new.category_id, new.name,
    new.brand, new.model, new.photo_path,
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

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'asset-photos',
  'asset-photos',
  true,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do nothing;

drop policy if exists "Anyone can read asset photos" on storage.objects;
drop policy if exists "Asset editors can upload asset photos" on storage.objects;
drop policy if exists "Asset editors can update asset photos" on storage.objects;
drop policy if exists "Asset editors can delete asset photos" on storage.objects;

create policy "Anyone can read asset photos"
on storage.objects for select
using (bucket_id = 'asset-photos');

-- The uploader owns the first path segment: the asset row does not exist yet
-- when a photo is picked on the registration form.
create policy "Asset editors can upload asset photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'asset-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (public.has_asset_permission('asset.create') or public.has_asset_permission('asset.update'))
);
create policy "Asset editors can update asset photos"
on storage.objects for update to authenticated
using (
  bucket_id = 'asset-photos'
  and public.has_asset_permission('asset.update')
) with check (bucket_id = 'asset-photos');
create policy "Asset editors can delete asset photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'asset-photos'
  and (public.has_asset_permission('asset.update') or public.has_asset_permission('asset.create'))
);
