-- ---------------------------------------------------------------------------
-- The signed transfer form, filed against the transfer it belongs to.
--
-- The printed form leaves the signature boxes blank because that is the point
-- of the paper: it is signed by hand on delivery. Once it comes back signed,
-- somebody photographs it and it belongs with the movement it records, not in
-- a folder on a desk. The QR code printed on the form opens that movement in
-- the register, so the person holding the paper can attach it from a phone.
--
-- Storage follows the receipts pattern already in this schema: a private
-- bucket, a metadata row that decides who may read the object, and a soft
-- removal so a detached file leaves a trace.
-- ---------------------------------------------------------------------------

create table if not exists public.asset_transfer_attachments (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.asset_transfers(id) on delete cascade,
  storage_bucket text not null default 'transfer-forms',
  storage_object_path text not null,
  original_filename text not null check (btrim(original_filename) <> ''),
  mime_type text not null check (btrim(mime_type) <> ''),
  size_bytes bigint not null check (size_bytes > 0),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  removed_at timestamptz,
  removed_by uuid references auth.users(id) on delete set null
);

comment on table public.asset_transfer_attachments is
  'Signed paperwork filed against a transfer: the form that came back with signatures on it.';
comment on column public.asset_transfer_attachments.removed_at is
  'Detaching is a soft removal, so a file that was once filed here leaves a trace.';

create unique index if not exists asset_transfer_attachments_path_uq
  on public.asset_transfer_attachments (storage_bucket, storage_object_path);
create index if not exists asset_transfer_attachments_current_idx
  on public.asset_transfer_attachments (transfer_id)
  where removed_at is null;

create or replace function public.set_transfer_attachment_remover()
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

drop trigger if exists asset_transfer_attachments_set_remover on public.asset_transfer_attachments;
create trigger asset_transfer_attachments_set_remover
before update on public.asset_transfer_attachments
for each row execute function public.set_transfer_attachment_remover();

alter table public.asset_transfer_attachments enable row level security;

-- Seeing the paperwork follows seeing the asset it moved; filing or detaching
-- it follows being allowed to move assets in the first place.
create policy transfer_attachments_scoped_read on public.asset_transfer_attachments
for select to authenticated using (
  public.has_asset_permission('asset.view')
  and exists (
    select 1 from public.asset_transfers t
    where t.id = transfer_id and public.can_access_asset_record(t.asset_id)
  )
);
create policy transfer_attachments_scoped_insert on public.asset_transfer_attachments
for insert to authenticated with check (
  public.has_asset_permission('asset.transfer')
  and exists (
    select 1 from public.asset_transfers t
    where t.id = transfer_id and public.can_access_asset_record(t.asset_id)
  )
);
create policy transfer_attachments_scoped_update on public.asset_transfer_attachments
for update to authenticated using (
  public.has_asset_permission('asset.transfer')
  and exists (
    select 1 from public.asset_transfers t
    where t.id = transfer_id and public.can_access_asset_record(t.asset_id)
  )
) with check (
  public.has_asset_permission('asset.transfer')
  and exists (
    select 1 from public.asset_transfers t
    where t.id = transfer_id and public.can_access_asset_record(t.asset_id)
  )
);

revoke all on table public.asset_transfer_attachments from anon, authenticated;
grant select, insert, update on table public.asset_transfer_attachments to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'transfer-forms',
  'transfer-forms',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf'
  ]
)
on conflict (id) do nothing;

-- An object is readable once its metadata row is, which is what carries the
-- company scoping. Uploads land under the caller's own folder because the
-- metadata row does not exist yet at that moment.
drop policy if exists "Scoped users can read transfer forms" on storage.objects;
drop policy if exists "Scoped users can upload transfer forms" on storage.objects;
drop policy if exists "Scoped users can update transfer forms" on storage.objects;
drop policy if exists "Scoped users can delete transfer forms" on storage.objects;

create policy "Scoped users can read transfer forms"
on storage.objects for select to authenticated
using (
  bucket_id = 'transfer-forms'
  and exists (
    select 1 from public.asset_transfer_attachments a
    where a.storage_bucket = bucket_id and a.storage_object_path = name
  )
);
create policy "Scoped users can upload transfer forms"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'transfer-forms'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.has_asset_permission('asset.transfer')
);
create policy "Scoped users can update transfer forms"
on storage.objects for update to authenticated
using (
  bucket_id = 'transfer-forms'
  and exists (
    select 1 from public.asset_transfer_attachments a
    where a.storage_bucket = bucket_id and a.storage_object_path = name
  )
) with check (bucket_id = 'transfer-forms');
create policy "Scoped users can delete transfer forms"
on storage.objects for delete to authenticated
using (
  bucket_id = 'transfer-forms'
  and exists (
    select 1 from public.asset_transfer_attachments a
    where a.storage_bucket = bucket_id and a.storage_object_path = name
  )
);
