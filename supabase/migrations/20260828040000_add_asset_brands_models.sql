-- ---------------------------------------------------------------------------
-- Brands and their models, configured rather than typed.
--
-- Brand and model went onto the asset as free text, which is how a register
-- ends up holding Komatsu, KOMATSU and Komatsu Ltd. as three different makes
-- and no report can group them. They are configured here instead, in Settings,
-- and the asset forms choose from the list.
--
-- A model belongs to a brand, so choosing Komatsu offers Komatsu's models and
-- nothing else. The asset itself still stores both as text: what was true when
-- an asset was registered stays readable even if the list is tidied later, the
-- same way a category rename does not rewrite history.
-- ---------------------------------------------------------------------------

create table if not exists public.asset_brands (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid()
);

create unique index if not exists asset_brands_name_ci_uq
  on public.asset_brands (lower(btrim(name)));

comment on table public.asset_brands is
  'Makes an asset can carry. The asset forms choose from this list rather than accepting free text.';

create table if not exists public.asset_models (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.asset_brands(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid()
);

-- One model per brand. Two brands may of course both sell a "300".
create unique index if not exists asset_models_brand_name_ci_uq
  on public.asset_models (brand_id, lower(btrim(name)));

comment on table public.asset_models is
  'Models belonging to a brand. Removing a brand removes its models with it.';

create trigger asset_brands_set_updated_metadata
before update on public.asset_brands
for each row execute function public.set_asset_updated_metadata();

create trigger asset_models_set_updated_metadata
before update on public.asset_models
for each row execute function public.set_asset_updated_metadata();

-- A permission of its own, in the catalogue so it can be granted per role or
-- per user like every other. Super Admins hold it already: has_asset_permission
-- short-circuits for them, which is why no seed row is needed here.
insert into public.permissions (permission_key, module, action, description)
values ('brands.manage', 'Brands and Models', 'Manage', 'Create, edit, and remove the brands and models the asset forms offer.')
on conflict (permission_key) do nothing;

alter table public.asset_brands enable row level security;
alter table public.asset_models enable row level security;

-- Anyone who may use the register may read the list, because the registration
-- form is built from it. Changing it is a Settings job.
drop policy if exists asset_brands_read on public.asset_brands;
create policy asset_brands_read on public.asset_brands
for select to authenticated using (public.is_active_asset_user());

drop policy if exists asset_brands_admin_write on public.asset_brands;
create policy asset_brands_admin_write on public.asset_brands
for all to authenticated
using (public.has_asset_permission('brands.manage'))
with check (public.has_asset_permission('brands.manage'));

drop policy if exists asset_models_read on public.asset_models;
create policy asset_models_read on public.asset_models
for select to authenticated using (public.is_active_asset_user());

drop policy if exists asset_models_admin_write on public.asset_models;
create policy asset_models_admin_write on public.asset_models
for all to authenticated
using (public.has_asset_permission('brands.manage'))
with check (public.has_asset_permission('brands.manage'));

grant select, insert, update, delete on table
  public.asset_brands,
  public.asset_models
to authenticated;
