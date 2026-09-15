-- ---------------------------------------------------------------------------
-- The paperwork that proves an asset is the company's.
--
-- A machine arrives with documents, and they outlive whoever filed them: the
-- sales invoice, the certificate of registration, the deed of sale. Kept in a
-- drawer they are found by asking the person who remembers; kept against the
-- asset row they are found by opening the asset.
--
-- Each file carries a type, because "which document is this" is the question
-- somebody asks before they ask anything else. The common three are offered as
-- a list in the form, but the column is free text: a register accumulates
-- paperwork nobody anticipated, and a check constraint on a closed vocabulary
-- would mean a migration every time a new kind of certificate turns up.
--
-- The bucket is private, unlike asset photos and like receipts. A photograph
-- of a bulldozer is not a financial record; a deed of sale is.
-- ---------------------------------------------------------------------------

create table if not exists public.asset_attachments (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  storage_bucket text not null default 'asset-documents',
  storage_object_path text not null,
  -- what the register calls this document, which is not what the scanner
  -- called the file; correctable later without moving the stored object
  original_filename text not null check (btrim(original_filename) <> ''),
  doc_type text not null check (btrim(doc_type) <> ''),
  mime_type text not null check (btrim(mime_type) <> ''),
  size_bytes bigint not null check (size_bytes > 0),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  removed_at timestamptz,
  removed_by uuid references auth.users(id) on delete set null
);

comment on table public.asset_attachments is
  'Documents filed against an asset: the invoice, registration and deed that prove what it is and whose it is.';
comment on column public.asset_attachments.doc_type is
  'What kind of document this is. The form offers the common three and lets the user name anything else, so this is deliberately not a closed vocabulary.';
comment on column public.asset_attachments.original_filename is
  'The label shown in the register. Editable, because a scanner names a deed of sale scan0043.pdf.';
comment on column public.asset_attachments.removed_at is
  'Removing is soft, so a document that was once filed here leaves a trace.';

create unique index if not exists asset_attachments_path_uq
  on public.asset_attachments (storage_bucket, storage_object_path);
create index if not exists asset_attachments_current_idx
  on public.asset_attachments (asset_id)
  where removed_at is null;

create or replace function public.set_asset_attachment_remover()
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

drop trigger if exists asset_attachments_set_remover on public.asset_attachments;
create trigger asset_attachments_set_remover
before update on public.asset_attachments
for each row execute function public.set_asset_attachment_remover();

alter table public.asset_attachments enable row level security;

-- Seeing an asset's paperwork follows seeing the asset. Filing it follows
-- being allowed to register or edit one, because that is when it is filed.
drop policy if exists asset_attachments_scoped_read on public.asset_attachments;
drop policy if exists asset_attachments_scoped_insert on public.asset_attachments;
drop policy if exists asset_attachments_scoped_update on public.asset_attachments;
create policy asset_attachments_scoped_read on public.asset_attachments
for select to authenticated using (
  public.has_asset_permission('asset.view')
  and public.can_access_asset_record(asset_id)
);
create policy asset_attachments_scoped_insert on public.asset_attachments
for insert to authenticated with check (
  (public.has_asset_permission('asset.create') or public.has_asset_permission('asset.update'))
  and public.can_access_asset_record(asset_id)
);
create policy asset_attachments_scoped_update on public.asset_attachments
for update to authenticated using (
  public.has_asset_permission('asset.update')
  and public.can_access_asset_record(asset_id)
) with check (
  public.has_asset_permission('asset.update')
  and public.can_access_asset_record(asset_id)
);

revoke all on table public.asset_attachments from anon, authenticated;
grant select, insert, update on table public.asset_attachments to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'asset-documents',
  'asset-documents',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do nothing;

-- An object is readable once its metadata row is, which is what carries the
-- company scoping. Uploads land under the caller's own folder because on the
-- registration form the asset row does not exist yet at that moment.
drop policy if exists "Scoped users can read asset documents" on storage.objects;
drop policy if exists "Scoped users can upload asset documents" on storage.objects;
drop policy if exists "Scoped users can update asset documents" on storage.objects;
drop policy if exists "Scoped users can delete asset documents" on storage.objects;

create policy "Scoped users can read asset documents"
on storage.objects for select to authenticated
using (
  bucket_id = 'asset-documents'
  and exists (
    select 1 from public.asset_attachments a
    where a.storage_bucket = bucket_id and a.storage_object_path = name
  )
);
create policy "Scoped users can upload asset documents"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'asset-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (public.has_asset_permission('asset.create') or public.has_asset_permission('asset.update'))
);
create policy "Scoped users can update asset documents"
on storage.objects for update to authenticated
using (
  bucket_id = 'asset-documents'
  and exists (
    select 1 from public.asset_attachments a
    where a.storage_bucket = bucket_id and a.storage_object_path = name
  )
) with check (bucket_id = 'asset-documents');
create policy "Scoped users can delete asset documents"
on storage.objects for delete to authenticated
using (
  bucket_id = 'asset-documents'
  and exists (
    select 1 from public.asset_attachments a
    where a.storage_bucket = bucket_id and a.storage_object_path = name
  )
);
