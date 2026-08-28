-- Responsible persons
--
-- The person an asset is signed out to used to be typed into a text box on the
-- registration form, with a suggestion list built from whatever had been typed
-- before. One person could therefore exist as three custodians, and no report
-- could tell they were the same person.
--
-- They are configured here instead, in Settings, and the asset forms pick from
-- this list. A person may belong to more than one company/branch; that link is
-- recorded for tracing later and is deliberately not used to filter the list
-- shown while an asset is being registered.

create table if not exists public.responsible_persons (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (btrim(first_name) <> ''),
  middle_name text,
  last_name text not null check (btrim(last_name) <> ''),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid()
);

-- One person, once. Compared without case or padding, the same way the rest of
-- the register compares the names it must keep unique.
create unique index if not exists responsible_persons_name_ci_uq
  on public.responsible_persons (
    lower(btrim(first_name)),
    lower(btrim(coalesce(middle_name, ''))),
    lower(btrim(last_name))
  );

comment on table public.responsible_persons is
  'People an asset can be signed out to. The asset forms choose from this list rather than accepting free text.';

-- The branch/company link: a checkbox list on the person, so someone who works
-- across two companies is one person, not two records.
create table if not exists public.responsible_person_companies (
  responsible_person_id uuid not null references public.responsible_persons(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  primary key (responsible_person_id, company_id)
);

comment on table public.responsible_person_companies is
  'Which companies/branches a person belongs to. Recorded for tracing; it does not narrow the list offered when registering an asset.';

create trigger responsible_persons_set_updated_metadata
before update on public.responsible_persons
for each row execute function public.set_asset_updated_metadata();

-- A permission of its own, in the catalogue so it can be granted per role or
-- per user like every other. Super Admins hold it already: has_asset_permission
-- short-circuits for them, which is why no seed row is needed here.
insert into public.permissions (permission_key, module, action, description)
values ('people.manage', 'Responsible Persons', 'Manage', 'Create, edit, and remove the people an asset can be signed out to.')
on conflict (permission_key) do nothing;

alter table public.responsible_persons enable row level security;
alter table public.responsible_person_companies enable row level security;

drop policy if exists responsible_persons_read on public.responsible_persons;
create policy responsible_persons_read on public.responsible_persons
for select to authenticated using (public.is_active_asset_user());

drop policy if exists responsible_persons_admin_insert on public.responsible_persons;
create policy responsible_persons_admin_insert on public.responsible_persons
for insert to authenticated with check (public.has_asset_permission('people.manage'));

drop policy if exists responsible_persons_admin_update on public.responsible_persons;
create policy responsible_persons_admin_update on public.responsible_persons
for update to authenticated using (public.has_asset_permission('people.manage'))
with check (public.has_asset_permission('people.manage'));

drop policy if exists responsible_persons_admin_delete on public.responsible_persons;
create policy responsible_persons_admin_delete on public.responsible_persons
for delete to authenticated using (public.has_asset_permission('people.manage'));

drop policy if exists responsible_person_companies_read on public.responsible_person_companies;
create policy responsible_person_companies_read on public.responsible_person_companies
for select to authenticated using (public.is_active_asset_user());

drop policy if exists responsible_person_companies_write on public.responsible_person_companies;
create policy responsible_person_companies_write on public.responsible_person_companies
for all to authenticated
using (public.has_asset_permission('people.manage'))
with check (public.has_asset_permission('people.manage'));
