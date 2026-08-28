-- Company logos
--
-- A company gets a mark of its own, shown beside its name wherever the
-- register lists companies. The bytes live in Supabase Storage, not in
-- PostgreSQL, exactly as receipts do; the table records only the path.
--
-- The bucket is public, which is the one deliberate difference from
-- asset-receipts. A logo is a brand mark rather than a business record, and a
-- public object renders from a plain URL — a signed URL would expire while a
-- settings page sat open and leave broken images behind it. Writing is still
-- restricted: only someone who may manage companies can put a file there.

alter table public.companies
  add column if not exists logo_path text;

comment on column public.companies.logo_path is
  'Path in the public company-logos Supabase Storage bucket. Null when the company has no mark; file bytes do not belong in PostgreSQL.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-logos',
  'company-logos',
  true,
  2097152,
  array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/svg+xml'
  ]
)
on conflict (id) do nothing;

drop policy if exists "Anyone can read company logos" on storage.objects;
create policy "Anyone can read company logos"
on storage.objects for select
using (bucket_id = 'company-logos');

drop policy if exists "Company managers can upload company logos" on storage.objects;
create policy "Company managers can upload company logos"
on storage.objects for insert
to authenticated
with check (bucket_id = 'company-logos' and public.has_asset_permission('companies.manage'));

drop policy if exists "Company managers can replace company logos" on storage.objects;
create policy "Company managers can replace company logos"
on storage.objects for update
to authenticated
using (bucket_id = 'company-logos' and public.has_asset_permission('companies.manage'))
with check (bucket_id = 'company-logos' and public.has_asset_permission('companies.manage'));

drop policy if exists "Company managers can delete company logos" on storage.objects;
create policy "Company managers can delete company logos"
on storage.objects for delete
to authenticated
using (bucket_id = 'company-logos' and public.has_asset_permission('companies.manage'));
