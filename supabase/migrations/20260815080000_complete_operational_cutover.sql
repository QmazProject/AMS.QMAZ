begin;

-- Atomic server-side reinstatement used by the Supabase operational adapter.
-- This remains SECURITY INVOKER so the caller's grants, RLS scope, and
-- column-aware authorization triggers all continue to apply.
create or replace function public.reinstate_asset(
  p_asset_id uuid,
  p_project_location_id uuid,
  p_address text,
  p_custodian text,
  p_effective_on date default current_date,
  p_reason text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  current_asset public.assets;
begin
  if not public.has_asset_permission('asset.retire')
     or not public.has_asset_permission('asset.transfer') then
    raise exception 'Asset retirement and transfer permissions are required'
      using errcode = '42501';
  end if;

  select * into current_asset
  from public.assets
  where id = p_asset_id
  for update;

  if not found or not public.can_access_asset_record(p_asset_id) then
    raise exception 'Asset is unavailable or outside the current user scope'
      using errcode = '42501';
  end if;
  if current_asset.status <> 'retired' then
    raise exception 'Only a retired asset can be reinstated'
      using errcode = '23514';
  end if;
  if nullif(btrim(p_address), '') is null or nullif(btrim(p_custodian), '') is null then
    raise exception 'A return address and custodian are required'
      using errcode = '23514';
  end if;

  if p_project_location_id is distinct from current_asset.project_location_id
     or p_address is distinct from current_asset.current_address
     or p_custodian is distinct from current_asset.current_custodian then
    insert into public.asset_transfers (
      asset_id, from_project_location_id, to_project_location_id,
      from_address, to_address, from_custodian, to_custodian,
      effective_on, reason, reference
    ) values (
      p_asset_id, current_asset.project_location_id, p_project_location_id,
      current_asset.current_address, btrim(p_address),
      current_asset.current_custodian, btrim(p_custodian),
      coalesce(p_effective_on, current_date),
      coalesce(nullif(btrim(p_reason), ''), 'Reinstated into service'),
      'REINSTATEMENT'
    );
  end if;

  update public.assets
  set status = 'active',
      retired_on = null,
      retirement_reason = null,
      retirement_details = null
  where id = p_asset_id;

  return p_asset_id;
end;
$$;

revoke all on function public.reinstate_asset(uuid, uuid, text, text, date, text)
from public, anon, authenticated;
grant execute on function public.reinstate_asset(uuid, uuid, text, text, date, text)
to authenticated;

-- Current receipt metadata is authoritative. Removed versions must not remain
-- readable, while owners may clean up an upload if metadata creation fails.
drop policy if exists "Scoped users can read asset receipts" on storage.objects;
create policy "Scoped users can read asset receipts"
on storage.objects for select to authenticated
using (
  bucket_id = 'asset-receipts'
  and exists (
    select 1
    from public.repair_part_receipts rpr
    where rpr.storage_bucket = bucket_id
      and rpr.storage_object_path = name
      and rpr.removed_at is null
  )
);

drop policy if exists "Scoped users can delete asset receipts" on storage.objects;
create policy "Scoped users can delete asset receipts"
on storage.objects for delete to authenticated
using (
  bucket_id = 'asset-receipts'
  and (
    exists (
      select 1
      from public.repair_part_receipts rpr
      where rpr.storage_bucket = bucket_id
        and rpr.storage_object_path = name
    )
    or (
      (storage.foldername(name))[1] = auth.uid()::text
      and (
        public.has_asset_permission('parts.manage')
        or public.has_asset_permission('purchasing.manage')
      )
    )
  )
);

commit;
