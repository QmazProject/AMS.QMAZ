-- ---------------------------------------------------------------------------
-- Files filed against a historic maintenance record.
--
-- A job that was done leaves paper behind that is not the Equipment Repair
-- Order itself: the contractor's quotation, the supplier's invoice, a photo of
-- the failed part, the signed sheet that came back from the yard. They belong
-- with the record of the job, so somebody opening that record later finds
-- them there rather than in a folder on a desk.
--
-- These are for the record only. The printed ERO sheet and its PDF never show
-- them and never mention them: the form is the form, and the attachments are
-- what was kept alongside it.
--
-- Storage follows the transfer-forms pattern already in this schema: a
-- private bucket, a metadata row that decides who may read the object, the
-- uploader's name stamped on at insert, and a soft removal so a file that was
-- once filed here leaves a trace. Word documents are allowed alongside PDFs
-- and images, since a quotation more often arrives as one than as a scan.
-- ---------------------------------------------------------------------------

create table if not exists public.maintenance_record_attachments (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.maintenance_records(id) on delete cascade,
  storage_bucket text not null default 'maintenance-attachments',
  storage_object_path text not null,
  original_filename text not null check (btrim(original_filename) <> ''),
  mime_type text not null check (btrim(mime_type) <> ''),
  size_bytes bigint not null check (size_bytes > 0),
  note text,
  uploaded_by_name text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  removed_at timestamptz,
  removed_by uuid references auth.users(id) on delete set null
);

comment on table public.maintenance_record_attachments is
  'Files kept with a historic maintenance record: quotations, invoices, photos, the signed sheet. Never printed on the ERO form.';
comment on column public.maintenance_record_attachments.original_filename is
  'The label shown in the register. Editable, because a phone names a photograph IMG_4471.jpg.';
comment on column public.maintenance_record_attachments.uploaded_by_name is
  'Display name of the account that filed the file, stamped at insert.';
comment on column public.maintenance_record_attachments.removed_at is
  'Removing is soft, so a file that was once filed here leaves a trace.';

create unique index if not exists maintenance_record_attachments_path_uq
  on public.maintenance_record_attachments (storage_bucket, storage_object_path);
create index if not exists maintenance_record_attachments_current_idx
  on public.maintenance_record_attachments (record_id)
  where removed_at is null;

-- who took it off, stamped when removed_at is first set
create or replace function public.set_maintenance_attachment_remover()
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

drop trigger if exists maintenance_record_attachments_set_remover on public.maintenance_record_attachments;
create trigger maintenance_record_attachments_set_remover
  before update on public.maintenance_record_attachments
  for each row execute function public.set_maintenance_attachment_remover();

-- who filed it, stamped at insert: a user may read only their own profile
-- row, so a colleague opening the record later would otherwise see nothing
create or replace function public.set_maintenance_attachment_uploader()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.uploaded_by_name is null or btrim(new.uploaded_by_name) = '' then
    select p.full_name into new.uploaded_by_name
    from public.user_profiles p
    where p.user_id = coalesce(new.created_by, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists maintenance_record_attachments_set_uploader on public.maintenance_record_attachments;
create trigger maintenance_record_attachments_set_uploader
  before insert on public.maintenance_record_attachments
  for each row execute function public.set_maintenance_attachment_uploader();

alter table public.maintenance_record_attachments enable row level security;

-- Seeing a record's files follows seeing the record. Filing one follows being
-- allowed to write a record up. Taking one off afterwards is the super
-- admin's alone, as changing the record itself is.
drop policy if exists maintenance_attachments_scoped_read on public.maintenance_record_attachments;
drop policy if exists maintenance_attachments_scoped_insert on public.maintenance_record_attachments;
drop policy if exists maintenance_attachments_admin_update on public.maintenance_record_attachments;

create policy maintenance_attachments_scoped_read on public.maintenance_record_attachments
for select to authenticated using (
  public.has_asset_permission('maintenance.view')
  and exists (
    select 1 from public.maintenance_records r
    where r.id = record_id and public.can_access_asset_record(r.asset_id)
  )
);
create policy maintenance_attachments_scoped_insert on public.maintenance_record_attachments
for insert to authenticated with check (
  public.has_asset_permission('maintenance.manage')
  and exists (
    select 1 from public.maintenance_records r
    where r.id = record_id and public.can_access_asset_record(r.asset_id)
  )
);
create policy maintenance_attachments_admin_update on public.maintenance_record_attachments
for update to authenticated using (
  public.is_asset_super_admin()
  and exists (
    select 1 from public.maintenance_records r
    where r.id = record_id and public.can_access_asset_record(r.asset_id)
  )
) with check (
  public.is_asset_super_admin()
  and exists (
    select 1 from public.maintenance_records r
    where r.id = record_id and public.can_access_asset_record(r.asset_id)
  )
);

revoke all on table public.maintenance_record_attachments from anon, authenticated;
grant select, insert, update on table public.maintenance_record_attachments to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'maintenance-attachments',
  'maintenance-attachments',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do nothing;

-- An object is readable once its metadata row is, which is what carries the
-- company scoping. Uploads land under the caller's own folder because the
-- metadata row does not exist yet at that moment.
drop policy if exists "Scoped users can read maintenance attachments" on storage.objects;
drop policy if exists "Scoped users can upload maintenance attachments" on storage.objects;
drop policy if exists "Scoped users can update maintenance attachments" on storage.objects;
drop policy if exists "Scoped users can delete maintenance attachments" on storage.objects;

create policy "Scoped users can read maintenance attachments"
on storage.objects for select to authenticated
using (
  bucket_id = 'maintenance-attachments'
  and exists (
    select 1 from public.maintenance_record_attachments a
    where a.storage_bucket = bucket_id and a.storage_object_path = name
  )
);
create policy "Scoped users can upload maintenance attachments"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'maintenance-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.has_asset_permission('maintenance.manage')
);
create policy "Scoped users can update maintenance attachments"
on storage.objects for update to authenticated
using (
  bucket_id = 'maintenance-attachments'
  and exists (
    select 1 from public.maintenance_record_attachments a
    where a.storage_bucket = bucket_id and a.storage_object_path = name
  )
) with check (bucket_id = 'maintenance-attachments');
create policy "Scoped users can delete maintenance attachments"
on storage.objects for delete to authenticated
using (
  bucket_id = 'maintenance-attachments'
  and exists (
    select 1 from public.maintenance_record_attachments a
    where a.storage_bucket = bucket_id and a.storage_object_path = name
  )
);
