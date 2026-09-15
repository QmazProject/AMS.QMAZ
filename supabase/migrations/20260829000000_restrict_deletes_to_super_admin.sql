-- ---------------------------------------------------------------------------
-- Destruction belongs to the Super Admin, and to nobody else.
--
-- Until now each area carried its own delete right alongside its right to add
-- and to edit: whoever could manage companies could delete one, whoever could
-- manage parts could drop a part. That is a reasonable default and it is not
-- the one this register wants. A yard clerk should be trusted to register,
-- move, repair and retire all day, and still not be able to erase what the
-- register remembers, because a deletion here takes the custody trail with it
-- and no amount of care afterwards brings it back.
--
-- So every hard delete now asks who you are rather than what your role was
-- granted. has_asset_permission already answers true for a Super Admin, so
-- this is a narrowing in every case and never a widening.
--
-- Two kinds of removal are deliberately left where they were, because they are
-- not deletions at all:
--
--   * A model row disappearing when somebody edits a brand's model list, and a
--     responsible_person_companies row disappearing when somebody edits which
--     companies a person covers. Both are how an edit is written, not an act
--     of destruction, and locking them would break ordinary editing.
--
--   * The stored object behind a photo, a logo or a receipt. Each of those is
--     also removed when the thing it belongs to is *replaced* during an edit,
--     and storage cannot tell a replacement from a removal. Restricting them
--     would stop a non-Super-Admin swapping an asset photo.
--
-- Purchase-receipt removal therefore remains enforced in the interface rather
-- than here, for the same reason: the row it soft-removes is the same row the
-- replace path soft-removes, and the two are indistinguishable at this level.
-- ---------------------------------------------------------------------------

-- Companies, asset groups and project/locations ------------------------------

drop policy if exists companies_admin_delete on public.companies;
create policy companies_admin_delete on public.companies
for delete to authenticated using (public.is_asset_super_admin());

drop policy if exists asset_categories_admin_delete on public.asset_categories;
create policy asset_categories_admin_delete on public.asset_categories
for delete to authenticated using (public.is_asset_super_admin());

drop policy if exists project_locations_admin_delete on public.project_locations;
create policy project_locations_admin_delete on public.project_locations
for delete to authenticated using (public.is_asset_super_admin());

-- The asset itself, and its scope still applies ------------------------------
-- Being a Super Admin says the deletion is permitted; can_access_asset_record
-- still says which records are in reach, and that is not relaxed here.

drop policy if exists assets_super_admin_delete on public.assets;
create policy assets_super_admin_delete on public.assets
for delete to authenticated using (
  public.is_asset_super_admin() and public.can_access_asset_record(id)
);

-- Repair parts and maintenance schedules -------------------------------------

drop policy if exists repair_parts_scoped_delete on public.repair_parts;
create policy repair_parts_scoped_delete on public.repair_parts
for delete to authenticated using (
  public.is_asset_super_admin()
  and exists (
    select 1 from public.repair_tickets rt
    where rt.id = repair_ticket_id and public.can_access_asset_record(rt.asset_id)
  )
);

drop policy if exists maintenance_schedules_scoped_delete on public.maintenance_schedules;
create policy maintenance_schedules_scoped_delete on public.maintenance_schedules
for delete to authenticated using (
  public.is_asset_super_admin() and public.can_access_asset_record(asset_id)
);

-- Responsible persons ---------------------------------------------------------

drop policy if exists responsible_persons_admin_delete on public.responsible_persons;
create policy responsible_persons_admin_delete on public.responsible_persons
for delete to authenticated using (public.is_asset_super_admin());

-- Brands ----------------------------------------------------------------------
-- asset_brands was written as one `for all` policy, which quietly included
-- delete. Splitting it keeps adding and renaming a make where it was and moves
-- only the destruction. asset_models is deliberately untouched: removing a
-- model is how the brand form saves a shortened list.

drop policy if exists asset_brands_admin_write on public.asset_brands;
create policy asset_brands_admin_insert on public.asset_brands
for insert to authenticated with check (public.has_asset_permission('brands.manage'));
create policy asset_brands_admin_update on public.asset_brands
for update to authenticated
using (public.has_asset_permission('brands.manage'))
with check (public.has_asset_permission('brands.manage'));
create policy asset_brands_admin_delete on public.asset_brands
for delete to authenticated using (public.is_asset_super_admin());

-- Detaching a filed transfer form ---------------------------------------------
-- A detach is a soft delete carried by an update, so no delete policy sees it.
-- The trigger that already stamps who removed it is the right place to ask
-- whether they were allowed to. Nothing else in the application sets
-- removed_at on this table, so there is no replace path to mistake for one.

create or replace function public.set_transfer_attachment_remover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.removed_at is not null and old.removed_at is null then
    if not public.is_asset_super_admin() then
      raise exception 'Only a Super Admin can detach a filed transfer form'
        using errcode = '42501';
    end if;
    new.removed_by := auth.uid();
  end if;
  return new;
end;
$$;

-- and the object behind it follows the same rule, since a filed form is never
-- replaced in place — it is detached and a new one is filed
drop policy if exists "Scoped users can delete transfer forms" on storage.objects;
create policy "Scoped users can delete transfer forms"
on storage.objects for delete to authenticated
using (
  bucket_id = 'transfer-forms'
  and public.is_asset_super_admin()
  and exists (
    select 1 from public.asset_transfer_attachments a
    where a.storage_bucket = bucket_id and a.storage_object_path = name
  )
);
