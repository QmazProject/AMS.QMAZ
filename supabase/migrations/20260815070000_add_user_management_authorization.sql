begin;

-- User Management and effective authorization for the Asset Management System.
--
-- Effective access is always:
--   an active account
--   + a granted role/user permission
--   + company scope
--   + asset-category scope
-- Super Admin bypasses company/category scope, but still requires an active account.

create table public.system_roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null unique check (btrim(name) <> ''),
  description text,
  is_system boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  permission_key text not null unique check (permission_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  module text not null check (btrim(module) <> ''),
  action text not null check (btrim(action) <> ''),
  description text,
  created_at timestamptz not null default now()
);

create table public.role_permissions (
  role_id uuid not null references public.system_roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  granted boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (btrim(full_name) <> ''),
  username text,
  role_id uuid not null references public.system_roles(id) on delete restrict,
  is_active boolean not null default true,
  all_companies boolean not null default false,
  all_asset_groups boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint user_profiles_username_chk check (username is null or btrim(username) <> '')
);

create unique index user_profiles_username_ci_uq
  on public.user_profiles (lower(btrim(username)))
  where username is not null;
create index user_profiles_role_idx on public.user_profiles (role_id);
create index user_profiles_active_idx on public.user_profiles (is_active) where is_active;

create table public.user_permission_overrides (
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  granted boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (user_id, permission_id)
);

create table public.user_company_access (
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (user_id, company_id)
);

create index user_company_access_company_idx on public.user_company_access (company_id, user_id);

create table public.user_asset_group_access (
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  asset_category_id uuid not null references public.asset_categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (user_id, asset_category_id)
);

create index user_asset_group_access_group_idx
  on public.user_asset_group_access (asset_category_id, user_id);

create table public.user_access_audit (
  id bigint primary key generated always as identity,
  performed_by uuid references auth.users(id) on delete set null,
  target_user uuid not null references auth.users(id) on delete restrict,
  action text not null check (btrim(action) <> ''),
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create index user_access_audit_target_idx
  on public.user_access_audit (target_user, created_at desc);
create index user_access_audit_actor_idx
  on public.user_access_audit (performed_by, created_at desc);

comment on table public.user_permission_overrides is
  'Optional per-user grants/denials. An override wins over the default role permission.';
comment on table public.user_access_audit is
  'Immutable audit history for privileged account, role, scope, and status changes.';

insert into public.system_roles (code, name, description)
values
  ('super_admin', 'Super Admin', 'Unrestricted system administrator.'),
  ('fa_admin', 'FA Admin', 'Operational fixed-asset administrator, restricted by assigned data scope.'),
  ('custodian', 'Custodian', 'Asset custodian with operational access, restricted by assigned data scope.'),
  ('purchaser', 'Purchaser', 'Parts and purchasing specialist with read-only operational visibility.'),
  ('technician', 'Technician', 'Repair technician with repair workflow access and read-only supporting data.');

insert into public.permissions (permission_key, module, action, description)
values
  ('asset.view', 'Assets', 'View', 'View asset list and details.'),
  ('asset.create', 'Assets', 'Create', 'Register a new asset.'),
  ('asset.update', 'Assets', 'Update', 'Edit normal asset details.'),
  ('asset.transfer', 'Assets', 'Transfer', 'Transfer custody or placement.'),
  ('asset.retire', 'Assets', 'Retire', 'Retire or reinstate an asset.'),
  ('asset.delete', 'Assets', 'Delete', 'Physically delete an asset and cascading history.'),
  ('repair.view', 'Repairs', 'View', 'View repair tickets and their history.'),
  ('repair.create', 'Repairs', 'Create', 'Open a repair ticket.'),
  ('repair.process', 'Repairs', 'Process', 'Diagnose and move operational repair stages.'),
  ('repair.cost', 'Repairs', 'Cost', 'Record repair labour and other costs.'),
  ('repair.close', 'Repairs', 'Close', 'Complete testing and close a repair ticket.'),
  ('parts.view', 'Parts', 'View', 'View repair parts and requirements.'),
  ('parts.manage', 'Parts', 'Manage', 'Create, edit, or remove part requirements.'),
  ('purchasing.manage', 'Purchasing', 'Manage', 'Order and purchase parts and manage supplier/cost details.'),
  ('maintenance.view', 'Maintenance', 'View', 'View maintenance schedules and history.'),
  ('maintenance.manage', 'Maintenance', 'Manage', 'Create schedules and record maintenance completion.'),
  ('map.view', 'Asset Map', 'View', 'View assets on the map.'),
  ('reports.view', 'Reports', 'View', 'View all operational and financial reports.'),
  ('reports.purchasing', 'Reports', 'Purchasing', 'View purchasing-related reports only.'),
  ('reports.export', 'Reports', 'Export', 'Export data already visible inside the user scope.'),
  ('companies.manage', 'Companies', 'Manage', 'Create, edit, and remove companies.'),
  ('asset_groups.manage', 'Asset Groups', 'Manage', 'Create, edit, and remove asset categories/groups.'),
  ('projects.manage', 'Projects', 'Manage', 'Create, import, edit, and remove project locations.'),
  ('audit.view', 'Audit', 'View', 'View immutable activity and forensic audit history.'),
  ('users.manage', 'User Management', 'Manage', 'Create and administer user accounts and access.');

-- Super Admin receives every current and future permission by explicit seed below;
-- future migrations must add their new permission to the appropriate roles.
insert into public.role_permissions (role_id, permission_id, granted)
select r.id, p.id, true
from public.system_roles r
cross join public.permissions p
where r.code = 'super_admin';

with matrix(role_code, permission_key) as (
  values
    ('fa_admin', 'asset.view'), ('fa_admin', 'asset.create'), ('fa_admin', 'asset.update'),
    ('fa_admin', 'asset.transfer'), ('fa_admin', 'asset.retire'),
    ('fa_admin', 'repair.view'), ('fa_admin', 'repair.create'), ('fa_admin', 'repair.process'),
    ('fa_admin', 'repair.cost'), ('fa_admin', 'repair.close'),
    ('fa_admin', 'parts.view'), ('fa_admin', 'parts.manage'), ('fa_admin', 'purchasing.manage'),
    ('fa_admin', 'maintenance.view'), ('fa_admin', 'maintenance.manage'),
    ('fa_admin', 'map.view'), ('fa_admin', 'reports.view'), ('fa_admin', 'reports.export'),

    ('custodian', 'asset.view'), ('custodian', 'asset.create'), ('custodian', 'asset.update'),
    ('custodian', 'asset.transfer'),
    ('custodian', 'repair.view'), ('custodian', 'repair.create'), ('custodian', 'repair.process'),
    ('custodian', 'repair.cost'), ('custodian', 'repair.close'),
    ('custodian', 'parts.view'), ('custodian', 'parts.manage'), ('custodian', 'purchasing.manage'),
    ('custodian', 'maintenance.view'), ('custodian', 'maintenance.manage'),
    ('custodian', 'map.view'), ('custodian', 'reports.view'), ('custodian', 'reports.export'),

    ('purchaser', 'asset.view'), ('purchaser', 'repair.view'),
    ('purchaser', 'parts.view'), ('purchaser', 'parts.manage'), ('purchaser', 'purchasing.manage'),
    ('purchaser', 'maintenance.view'), ('purchaser', 'map.view'),
    ('purchaser', 'reports.purchasing'), ('purchaser', 'reports.export'),

    ('technician', 'asset.view'), ('technician', 'repair.view'),
    ('technician', 'repair.process'), ('technician', 'repair.close'),
    ('technician', 'parts.view'), ('technician', 'maintenance.view'), ('technician', 'map.view')
)
insert into public.role_permissions (role_id, permission_id, granted)
select r.id, p.id, true
from matrix m
join public.system_roles r on r.code = m.role_code
join public.permissions p on p.permission_key = m.permission_key;

create or replace function public.is_active_asset_user(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
    from public.user_profiles up
    where up.user_id = p_user_id
      and up.is_active
  );
$$;

create or replace function public.is_asset_super_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
    from public.user_profiles up
    join public.system_roles sr on sr.id = up.role_id
    where up.user_id = p_user_id
      and up.is_active
      and sr.code = 'super_admin'
  );
$$;

create or replace function public.has_asset_permission(
  p_permission_key text,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_asset_user(p_user_id)
    and (
      public.is_asset_super_admin(p_user_id)
      or coalesce(
        (
          select upo.granted
          from public.user_permission_overrides upo
          join public.permissions p on p.id = upo.permission_id
          where upo.user_id = p_user_id
            and p.permission_key = p_permission_key
        ),
        (
          select rp.granted
          from public.user_profiles up
          join public.role_permissions rp on rp.role_id = up.role_id
          join public.permissions p on p.id = rp.permission_id
          where up.user_id = p_user_id
            and p.permission_key = p_permission_key
        ),
        false
      )
    );
$$;

create or replace function public.can_access_asset_company(
  p_company_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_asset_user(p_user_id)
    and (
      public.is_asset_super_admin(p_user_id)
      or exists (
        select 1
        from public.user_profiles up
        where up.user_id = p_user_id and up.all_companies
      )
      or (
        p_company_id is not null
        and exists (
          select 1
          from public.user_company_access uca
          where uca.user_id = p_user_id and uca.company_id = p_company_id
        )
      )
    );
$$;

create or replace function public.can_access_asset_group(
  p_asset_category_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_asset_user(p_user_id)
    and (
      public.is_asset_super_admin(p_user_id)
      or exists (
        select 1
        from public.user_profiles up
        where up.user_id = p_user_id and up.all_asset_groups
      )
      or (
        p_asset_category_id is not null
        and exists (
          select 1
          from public.user_asset_group_access uaga
          where uaga.user_id = p_user_id
            and uaga.asset_category_id = p_asset_category_id
        )
      )
    );
$$;

create or replace function public.can_access_asset_record(
  p_asset_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.assets a
    where a.id = p_asset_id
      and public.can_access_asset_company(a.company_id, p_user_id)
      and public.can_access_asset_group(a.category_id, p_user_id)
  );
$$;

create or replace function public.user_access_snapshot(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', up.user_id,
    'full_name', up.full_name,
    'username', up.username,
    'role', sr.code,
    'is_active', up.is_active,
    'all_companies', up.all_companies,
    'all_asset_groups', up.all_asset_groups,
    'company_ids', coalesce((
      select jsonb_agg(uca.company_id order by uca.company_id)
      from public.user_company_access uca where uca.user_id = up.user_id
    ), '[]'::jsonb),
    'asset_group_ids', coalesce((
      select jsonb_agg(uaga.asset_category_id order by uaga.asset_category_id)
      from public.user_asset_group_access uaga where uaga.user_id = up.user_id
    ), '[]'::jsonb),
    'permission_overrides', coalesce((
      select jsonb_object_agg(p.permission_key, upo.granted order by p.permission_key)
      from public.user_permission_overrides upo
      join public.permissions p on p.id = upo.permission_id
      where upo.user_id = up.user_id
    ), '{}'::jsonb)
  )
  from public.user_profiles up
  join public.system_roles sr on sr.id = up.role_id
  where up.user_id = p_user_id;
$$;

create or replace function public.current_asset_user_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', up.user_id,
    'full_name', up.full_name,
    'username', up.username,
    'email', coalesce(auth.jwt() ->> 'email', ''),
    'role', sr.code,
    'role_name', sr.name,
    'is_active', up.is_active,
    'is_super_admin', sr.code = 'super_admin' and up.is_active,
    'all_companies', up.all_companies or sr.code = 'super_admin',
    'all_asset_groups', up.all_asset_groups or sr.code = 'super_admin',
    'company_ids', coalesce((
      select jsonb_agg(uca.company_id order by uca.company_id)
      from public.user_company_access uca where uca.user_id = up.user_id
    ), '[]'::jsonb),
    'company_names', coalesce((
      select jsonb_agg(c.name order by c.name)
      from public.user_company_access uca
      join public.companies c on c.id = uca.company_id
      where uca.user_id = up.user_id
    ), '[]'::jsonb),
    'asset_group_ids', coalesce((
      select jsonb_agg(uaga.asset_category_id order by uaga.asset_category_id)
      from public.user_asset_group_access uaga where uaga.user_id = up.user_id
    ), '[]'::jsonb),
    'asset_group_names', coalesce((
      select jsonb_agg(ac.name order by ac.name)
      from public.user_asset_group_access uaga
      join public.asset_categories ac on ac.id = uaga.asset_category_id
      where uaga.user_id = up.user_id
    ), '[]'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(e.permission_key order by e.permission_key)
      from (
        select p.permission_key,
          coalesce(upo.granted, rp.granted, false) as granted
        from public.permissions p
        left join public.role_permissions rp
          on rp.permission_id = p.id and rp.role_id = up.role_id
        left join public.user_permission_overrides upo
          on upo.permission_id = p.id and upo.user_id = up.user_id
      ) e
      where e.granted or sr.code = 'super_admin'
    ), '[]'::jsonb)
  )
  from public.user_profiles up
  join public.system_roles sr on sr.id = up.role_id
  where up.user_id = auth.uid();
$$;

create or replace function public.admin_set_asset_user_access(
  p_actor_id uuid,
  p_user_id uuid,
  p_full_name text,
  p_username text,
  p_role_code text,
  p_is_active boolean,
  p_all_companies boolean,
  p_all_asset_groups boolean,
  p_company_ids uuid[] default '{}'::uuid[],
  p_asset_group_ids uuid[] default '{}'::uuid[],
  p_permission_overrides jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role_id uuid;
  v_old jsonb;
  v_new jsonb;
  v_company_id uuid;
  v_group_id uuid;
  v_override record;
begin
  if not public.is_asset_super_admin(p_actor_id) then
    raise exception 'Only an active Super Admin may manage users' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'Authentication user does not exist' using errcode = '23503';
  end if;
  if nullif(btrim(p_full_name), '') is null then
    raise exception 'Full name is required' using errcode = '22023';
  end if;

  select sr.id into v_role_id from public.system_roles sr where sr.code = p_role_code;
  if v_role_id is null then
    raise exception 'Unknown system role: %', p_role_code using errcode = '22023';
  end if;
  if p_permission_overrides is null or jsonb_typeof(p_permission_overrides) <> 'object' then
    raise exception 'Permission overrides must be a JSON object' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_company_ids, '{}'::uuid[])) x(id)
    left join public.companies c on c.id = x.id where c.id is null
  ) then
    raise exception 'One or more company assignments do not exist' using errcode = '23503';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_asset_group_ids, '{}'::uuid[])) x(id)
    left join public.asset_categories ac on ac.id = x.id where ac.id is null
  ) then
    raise exception 'One or more asset-group assignments do not exist' using errcode = '23503';
  end if;
  if p_role_code = 'super_admin' then
    p_is_active := true;
    p_all_companies := true;
    p_all_asset_groups := true;
  end if;
  if p_role_code <> 'super_admin'
     and exists (
       select 1
       from public.user_profiles up
       join public.system_roles sr on sr.id = up.role_id
       where up.user_id = p_user_id and up.is_active and sr.code = 'super_admin'
     )
     and not exists (
       select 1
       from public.user_profiles up
       join public.system_roles sr on sr.id = up.role_id
       where up.user_id <> p_user_id and up.is_active and sr.code = 'super_admin'
     ) then
    raise exception 'The last active Super Admin cannot be demoted' using errcode = '42501';
  end if;

  v_old := public.user_access_snapshot(p_user_id);

  insert into public.user_profiles (
    user_id, full_name, username, role_id, is_active, all_companies,
    all_asset_groups, created_by, updated_by
  ) values (
    p_user_id, btrim(p_full_name), nullif(btrim(p_username), ''), v_role_id,
    p_is_active, p_all_companies, p_all_asset_groups, p_actor_id, p_actor_id
  )
  on conflict (user_id) do update set
    full_name = excluded.full_name,
    username = excluded.username,
    role_id = excluded.role_id,
    is_active = excluded.is_active,
    all_companies = excluded.all_companies,
    all_asset_groups = excluded.all_asset_groups,
    updated_at = now(),
    updated_by = p_actor_id;

  delete from public.user_company_access where user_id = p_user_id;
  if not p_all_companies then
    insert into public.user_company_access (user_id, company_id, created_by)
    select p_user_id, x.id, p_actor_id
    from (select distinct unnest(coalesce(p_company_ids, '{}'::uuid[])) as id) x;
  end if;

  delete from public.user_asset_group_access where user_id = p_user_id;
  if not p_all_asset_groups then
    insert into public.user_asset_group_access (user_id, asset_category_id, created_by)
    select p_user_id, x.id, p_actor_id
    from (select distinct unnest(coalesce(p_asset_group_ids, '{}'::uuid[])) as id) x;
  end if;

  delete from public.user_permission_overrides where user_id = p_user_id;
  for v_override in
    select p.id as permission_id, e.value::boolean as granted
    from jsonb_each_text(p_permission_overrides) e
    join public.permissions p on p.permission_key = e.key
  loop
    insert into public.user_permission_overrides (user_id, permission_id, granted, updated_by)
    values (p_user_id, v_override.permission_id, v_override.granted, p_actor_id);
  end loop;

  v_new := public.user_access_snapshot(p_user_id);

  if v_old is null then
    insert into public.user_access_audit (performed_by, target_user, action, new_value)
    values (p_actor_id, p_user_id, 'user_created', v_new);
  else
    if v_old ->> 'role' is distinct from v_new ->> 'role' then
      insert into public.user_access_audit (performed_by, target_user, action, old_value, new_value)
      values (p_actor_id, p_user_id, 'role_changed',
        jsonb_build_object('role', v_old ->> 'role'), jsonb_build_object('role', v_new ->> 'role'));
    end if;
    if (v_old ->> 'is_active')::boolean is distinct from (v_new ->> 'is_active')::boolean then
      insert into public.user_access_audit (performed_by, target_user, action, old_value, new_value)
      values (p_actor_id, p_user_id,
        case when (v_new ->> 'is_active')::boolean then 'account_reactivated' else 'account_deactivated' end,
        jsonb_build_object('is_active', (v_old ->> 'is_active')::boolean),
        jsonb_build_object('is_active', (v_new ->> 'is_active')::boolean));
    end if;
  end if;

  for v_company_id in
    select jsonb_array_elements_text(coalesce(v_new -> 'company_ids', '[]'::jsonb))::uuid
    except
    select jsonb_array_elements_text(coalesce(v_old -> 'company_ids', '[]'::jsonb))::uuid
  loop
    insert into public.user_access_audit (performed_by, target_user, action, new_value)
    values (p_actor_id, p_user_id, 'company_access_added', jsonb_build_object('company_id', v_company_id));
  end loop;
  for v_company_id in
    select jsonb_array_elements_text(coalesce(v_old -> 'company_ids', '[]'::jsonb))::uuid
    except
    select jsonb_array_elements_text(coalesce(v_new -> 'company_ids', '[]'::jsonb))::uuid
  loop
    insert into public.user_access_audit (performed_by, target_user, action, old_value)
    values (p_actor_id, p_user_id, 'company_access_removed', jsonb_build_object('company_id', v_company_id));
  end loop;

  for v_group_id in
    select jsonb_array_elements_text(coalesce(v_new -> 'asset_group_ids', '[]'::jsonb))::uuid
    except
    select jsonb_array_elements_text(coalesce(v_old -> 'asset_group_ids', '[]'::jsonb))::uuid
  loop
    insert into public.user_access_audit (performed_by, target_user, action, new_value)
    values (p_actor_id, p_user_id, 'asset_group_access_added', jsonb_build_object('asset_group_id', v_group_id));
  end loop;
  for v_group_id in
    select jsonb_array_elements_text(coalesce(v_old -> 'asset_group_ids', '[]'::jsonb))::uuid
    except
    select jsonb_array_elements_text(coalesce(v_new -> 'asset_group_ids', '[]'::jsonb))::uuid
  loop
    insert into public.user_access_audit (performed_by, target_user, action, old_value)
    values (p_actor_id, p_user_id, 'asset_group_access_removed', jsonb_build_object('asset_group_id', v_group_id));
  end loop;

  if v_old is not null and v_old is distinct from v_new then
    insert into public.user_access_audit (performed_by, target_user, action, old_value, new_value)
    values (p_actor_id, p_user_id, 'user_access_updated', v_old, v_new);
  end if;
  return v_new;
end;
$$;

create or replace function public.admin_record_asset_auth_event(
  p_actor_id uuid,
  p_target_user uuid,
  p_action text,
  p_old_value jsonb default null,
  p_new_value jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_asset_super_admin(p_actor_id) then
    raise exception 'Only an active Super Admin may record account events' using errcode = '42501';
  end if;
  if p_action not in ('auth_account_created', 'auth_identity_updated', 'password_recovery_requested') then
    raise exception 'Unsupported authentication audit action' using errcode = '22023';
  end if;
  insert into public.user_access_audit (performed_by, target_user, action, old_value, new_value)
  values (p_actor_id, p_target_user, p_action, p_old_value, p_new_value);
end;
$$;

create or replace function public.bootstrap_asset_super_admin(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_role_id uuid;
  v_name text;
begin
  select u.id, coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1))
    into v_user_id, v_name
  from auth.users u
  where lower(u.email) = lower(btrim(p_email));
  if v_user_id is null then
    raise exception 'No Supabase Auth user exists for %', p_email using errcode = 'P0002';
  end if;
  select id into v_role_id from public.system_roles where code = 'super_admin';
  insert into public.user_profiles (
    user_id, full_name, username, role_id, is_active, all_companies, all_asset_groups
  ) values (
    v_user_id, v_name, split_part(p_email, '@', 1), v_role_id, true, true, true
  )
  on conflict (user_id) do update set
    role_id = excluded.role_id,
    is_active = true,
    all_companies = true,
    all_asset_groups = true,
    updated_at = now();
  insert into public.user_access_audit (performed_by, target_user, action, new_value)
  values (null, v_user_id, 'bootstrap_super_admin', public.user_access_snapshot(v_user_id));
  return v_user_id;
end;
$$;

-- Column-aware guards ensure a broad UPDATE policy cannot be used to perform a
-- different action. Nested updates made by the existing trusted workflow triggers
-- are allowed; those functions are converted to SECURITY DEFINER below.
create or replace function public.authorize_direct_asset_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if (new.project_location_id, new.current_address, new.current_custodian)
      is distinct from (old.project_location_id, old.current_address, old.current_custodian)
     and not public.has_asset_permission('asset.transfer') then
    raise exception 'Asset transfer permission is required' using errcode = '42501';
  end if;
  if (new.status, new.retired_on, new.retirement_reason, new.retirement_details)
      is distinct from (old.status, old.retired_on, old.retirement_reason, old.retirement_details)
     and not public.has_asset_permission('asset.retire') then
    raise exception 'Asset retirement permission is required' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['project_location_id','current_address','current_custodian','status',
        'retired_on','retirement_reason','retirement_details','updated_at','updated_by','revision'])
      is distinct from
     (to_jsonb(old) - array['project_location_id','current_address','current_custodian','status',
        'retired_on','retirement_reason','retirement_details','updated_at','updated_by','revision'])
     and not public.has_asset_permission('asset.update') then
    raise exception 'Asset edit permission is required' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger assets_authorize_direct_update
before update on public.assets
for each row execute function public.authorize_direct_asset_update();

create or replace function public.authorize_repair_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.asset_id is distinct from old.asset_id then
    raise exception 'A repair ticket cannot be moved to another asset' using errcode = '42501';
  end if;
  if (new.labor_cost, new.other_cost) is distinct from (old.labor_cost, old.other_cost)
     and not public.has_asset_permission('repair.cost') then
    raise exception 'Repair cost permission is required' using errcode = '42501';
  end if;
  if new.stage = 'closed' and old.stage <> 'closed'
     and not public.has_asset_permission('repair.close') then
    raise exception 'Repair close permission is required' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['labor_cost','other_cost','updated_at','updated_by'])
      is distinct from (to_jsonb(old) - array['labor_cost','other_cost','updated_at','updated_by'])
     and new.stage <> 'closed'
     and not public.has_asset_permission('repair.process') then
    raise exception 'Repair processing permission is required' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger repair_tickets_authorize_update
before update on public.repair_tickets
for each row execute function public.authorize_repair_update();

create or replace function public.authorize_repair_part_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.repair_ticket_id is distinct from old.repair_ticket_id then
    raise exception 'A repair part cannot be moved to another ticket' using errcode = '42501';
  end if;
  if (new.state, new.unit_price, new.supplier, new.ordered_on, new.purchased_on, new.order_reference)
      is distinct from (old.state, old.unit_price, old.supplier, old.ordered_on, old.purchased_on, old.order_reference)
     and not public.has_asset_permission('purchasing.manage') then
    raise exception 'Purchasing permission is required' using errcode = '42501';
  end if;
  if (new.name, new.quantity, new.estimated_amount, new.needed_on)
      is distinct from (old.name, old.quantity, old.estimated_amount, old.needed_on)
     and not public.has_asset_permission('parts.manage') then
    raise exception 'Parts management permission is required' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger repair_parts_authorize_update
before update on public.repair_parts
for each row execute function public.authorize_repair_part_update();

-- Existing trigger-only functions must be able to write immutable history and
-- perform validated workflow side effects without granting direct table access.
alter function public.audit_asset_row() security definer;
alter function public.record_asset_registration() security definer;
alter function public.record_asset_status_change() security definer;
alter function public.record_asset_details_change() security definer;
alter function public.apply_asset_transfer() security definer;
alter function public.sync_repair_ticket_workflow() security definer;
alter function public.record_repair_part_activity() security definer;
alter function public.record_receipt_activity() security definer;
alter function public.record_maintenance_schedule() security definer;
alter function public.apply_maintenance_completion() security definer;

-- Replace the initial migration's permissive authenticated policies.
drop policy if exists companies_authenticated_manage on public.companies;
drop policy if exists asset_categories_authenticated_manage on public.asset_categories;
drop policy if exists project_locations_authenticated_manage on public.project_locations;
drop policy if exists assets_authenticated_manage on public.assets;
drop policy if exists repair_tickets_authenticated_manage on public.repair_tickets;
drop policy if exists repair_parts_authenticated_manage on public.repair_parts;
drop policy if exists repair_part_receipts_authenticated_manage on public.repair_part_receipts;
drop policy if exists maintenance_schedules_authenticated_manage on public.maintenance_schedules;
drop policy if exists asset_transfers_authenticated_read on public.asset_transfers;
drop policy if exists asset_transfers_authenticated_insert on public.asset_transfers;
drop policy if exists maintenance_completions_authenticated_read on public.maintenance_completions;
drop policy if exists maintenance_completions_authenticated_insert on public.maintenance_completions;
drop policy if exists asset_activity_authenticated_read on public.asset_activity;
drop policy if exists asset_activity_authenticated_insert on public.asset_activity;
drop policy if exists asset_audit_log_authenticated_read on public.asset_audit_log;

alter table public.system_roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_profiles enable row level security;
alter table public.user_permission_overrides enable row level security;
alter table public.user_company_access enable row level security;
alter table public.user_asset_group_access enable row level security;
alter table public.user_access_audit enable row level security;

create policy system_roles_active_read on public.system_roles
for select to authenticated using (public.is_active_asset_user());
create policy permissions_active_read on public.permissions
for select to authenticated using (public.is_active_asset_user());
create policy role_permissions_active_read on public.role_permissions
for select to authenticated using (public.is_active_asset_user());
create policy user_profiles_self_or_admin_read on public.user_profiles
for select to authenticated using (user_id = auth.uid() or public.has_asset_permission('users.manage'));
create policy user_overrides_self_or_admin_read on public.user_permission_overrides
for select to authenticated using (user_id = auth.uid() or public.has_asset_permission('users.manage'));
create policy user_company_scope_self_or_admin_read on public.user_company_access
for select to authenticated using (user_id = auth.uid() or public.has_asset_permission('users.manage'));
create policy user_group_scope_self_or_admin_read on public.user_asset_group_access
for select to authenticated using (user_id = auth.uid() or public.has_asset_permission('users.manage'));
create policy user_access_audit_admin_read on public.user_access_audit
for select to authenticated using (public.has_asset_permission('users.manage'));

create policy companies_scoped_read on public.companies
for select to authenticated using (
  public.is_active_asset_user() and public.can_access_asset_company(id)
);
create policy companies_admin_insert on public.companies
for insert to authenticated with check (public.has_asset_permission('companies.manage'));
create policy companies_admin_update on public.companies
for update to authenticated using (public.has_asset_permission('companies.manage'))
with check (public.has_asset_permission('companies.manage'));
create policy companies_admin_delete on public.companies
for delete to authenticated using (public.has_asset_permission('companies.manage'));

create policy asset_categories_scoped_read on public.asset_categories
for select to authenticated using (
  public.is_active_asset_user() and public.can_access_asset_group(id)
);
create policy asset_categories_admin_insert on public.asset_categories
for insert to authenticated with check (public.has_asset_permission('asset_groups.manage'));
create policy asset_categories_admin_update on public.asset_categories
for update to authenticated using (public.has_asset_permission('asset_groups.manage'))
with check (public.has_asset_permission('asset_groups.manage'));
create policy asset_categories_admin_delete on public.asset_categories
for delete to authenticated using (public.has_asset_permission('asset_groups.manage'));

create policy project_locations_active_read on public.project_locations
for select to authenticated using (public.has_asset_permission('asset.view'));
create policy project_locations_admin_insert on public.project_locations
for insert to authenticated with check (public.has_asset_permission('projects.manage'));
create policy project_locations_admin_update on public.project_locations
for update to authenticated using (public.has_asset_permission('projects.manage'))
with check (public.has_asset_permission('projects.manage'));
create policy project_locations_admin_delete on public.project_locations
for delete to authenticated using (public.has_asset_permission('projects.manage'));

create policy assets_scoped_read on public.assets
for select to authenticated using (
  public.has_asset_permission('asset.view')
  and public.can_access_asset_company(company_id)
  and public.can_access_asset_group(category_id)
);
create policy assets_scoped_insert on public.assets
for insert to authenticated with check (
  public.has_asset_permission('asset.create')
  and public.can_access_asset_company(company_id)
  and public.can_access_asset_group(category_id)
);
create policy assets_scoped_update on public.assets
for update to authenticated using (
  public.can_access_asset_company(company_id)
  and public.can_access_asset_group(category_id)
  and (
    public.has_asset_permission('asset.update')
    or public.has_asset_permission('asset.transfer')
    or public.has_asset_permission('asset.retire')
  )
) with check (
  public.can_access_asset_company(company_id)
  and public.can_access_asset_group(category_id)
);
create policy assets_super_admin_delete on public.assets
for delete to authenticated using (
  public.has_asset_permission('asset.delete') and public.can_access_asset_record(id)
);

create policy asset_transfers_scoped_read on public.asset_transfers
for select to authenticated using (
  public.has_asset_permission('asset.view') and public.can_access_asset_record(asset_id)
);
create policy asset_transfers_scoped_insert on public.asset_transfers
for insert to authenticated with check (
  public.has_asset_permission('asset.transfer') and public.can_access_asset_record(asset_id)
);

create policy repair_tickets_scoped_read on public.repair_tickets
for select to authenticated using (
  public.has_asset_permission('repair.view') and public.can_access_asset_record(asset_id)
);
create policy repair_tickets_scoped_insert on public.repair_tickets
for insert to authenticated with check (
  public.has_asset_permission('repair.create') and public.can_access_asset_record(asset_id)
);
create policy repair_tickets_scoped_update on public.repair_tickets
for update to authenticated using (
  public.can_access_asset_record(asset_id)
  and (
    public.has_asset_permission('repair.process')
    or public.has_asset_permission('repair.cost')
    or public.has_asset_permission('repair.close')
  )
) with check (public.can_access_asset_record(asset_id));

create policy repair_parts_scoped_read on public.repair_parts
for select to authenticated using (
  public.has_asset_permission('parts.view')
  and exists (
    select 1 from public.repair_tickets rt
    where rt.id = repair_ticket_id and public.can_access_asset_record(rt.asset_id)
  )
);
create policy repair_parts_scoped_insert on public.repair_parts
for insert to authenticated with check (
  (public.has_asset_permission('parts.manage') or public.has_asset_permission('purchasing.manage'))
  and exists (
    select 1 from public.repair_tickets rt
    where rt.id = repair_ticket_id and public.can_access_asset_record(rt.asset_id)
  )
);
create policy repair_parts_scoped_update on public.repair_parts
for update to authenticated using (
  (public.has_asset_permission('parts.manage') or public.has_asset_permission('purchasing.manage'))
  and exists (
    select 1 from public.repair_tickets rt
    where rt.id = repair_ticket_id and public.can_access_asset_record(rt.asset_id)
  )
) with check (
  exists (
    select 1 from public.repair_tickets rt
    where rt.id = repair_ticket_id and public.can_access_asset_record(rt.asset_id)
  )
);
create policy repair_parts_scoped_delete on public.repair_parts
for delete to authenticated using (
  public.has_asset_permission('parts.manage')
  and exists (
    select 1 from public.repair_tickets rt
    where rt.id = repair_ticket_id and public.can_access_asset_record(rt.asset_id)
  )
);

create policy repair_receipts_scoped_read on public.repair_part_receipts
for select to authenticated using (
  public.has_asset_permission('parts.view')
  and exists (
    select 1
    from public.repair_parts rp
    join public.repair_tickets rt on rt.id = rp.repair_ticket_id
    where rp.id = repair_part_id and public.can_access_asset_record(rt.asset_id)
  )
);
create policy repair_receipts_scoped_insert on public.repair_part_receipts
for insert to authenticated with check (
  (public.has_asset_permission('parts.manage') or public.has_asset_permission('purchasing.manage'))
  and exists (
    select 1
    from public.repair_parts rp
    join public.repair_tickets rt on rt.id = rp.repair_ticket_id
    where rp.id = repair_part_id and public.can_access_asset_record(rt.asset_id)
  )
);
create policy repair_receipts_scoped_update on public.repair_part_receipts
for update to authenticated using (
  (public.has_asset_permission('parts.manage') or public.has_asset_permission('purchasing.manage'))
  and exists (
    select 1
    from public.repair_parts rp
    join public.repair_tickets rt on rt.id = rp.repair_ticket_id
    where rp.id = repair_part_id and public.can_access_asset_record(rt.asset_id)
  )
) with check (
  (public.has_asset_permission('parts.manage') or public.has_asset_permission('purchasing.manage'))
  and exists (
    select 1
    from public.repair_parts rp
    join public.repair_tickets rt on rt.id = rp.repair_ticket_id
    where rp.id = repair_part_id and public.can_access_asset_record(rt.asset_id)
  )
);

create policy maintenance_schedules_scoped_read on public.maintenance_schedules
for select to authenticated using (
  public.has_asset_permission('maintenance.view') and public.can_access_asset_record(asset_id)
);
create policy maintenance_schedules_scoped_insert on public.maintenance_schedules
for insert to authenticated with check (
  public.has_asset_permission('maintenance.manage') and public.can_access_asset_record(asset_id)
);
create policy maintenance_schedules_scoped_update on public.maintenance_schedules
for update to authenticated using (
  public.has_asset_permission('maintenance.manage') and public.can_access_asset_record(asset_id)
) with check (public.can_access_asset_record(asset_id));
create policy maintenance_schedules_scoped_delete on public.maintenance_schedules
for delete to authenticated using (
  public.has_asset_permission('maintenance.manage') and public.can_access_asset_record(asset_id)
);

create policy maintenance_completions_scoped_read on public.maintenance_completions
for select to authenticated using (
  public.has_asset_permission('maintenance.view')
  and exists (
    select 1 from public.maintenance_schedules ms
    where ms.id = maintenance_schedule_id and public.can_access_asset_record(ms.asset_id)
  )
);
create policy maintenance_completions_scoped_insert on public.maintenance_completions
for insert to authenticated with check (
  public.has_asset_permission('maintenance.manage')
  and exists (
    select 1 from public.maintenance_schedules ms
    where ms.id = maintenance_schedule_id and public.can_access_asset_record(ms.asset_id)
  )
);

create policy asset_activity_scoped_read on public.asset_activity
for select to authenticated using (
  public.has_asset_permission('asset.view') and public.can_access_asset_record(asset_id)
);
create policy asset_audit_log_admin_read on public.asset_audit_log
for select to authenticated using (public.has_asset_permission('audit.view'));

-- Storage: an uploader must have an appropriate purchasing/parts permission.
-- Reading, changing, or deleting an object additionally requires a scoped receipt
-- metadata row. New objects use a caller-owned first path segment until metadata exists.
drop policy if exists "Authenticated users can read asset receipts" on storage.objects;
drop policy if exists "Authenticated users can upload asset receipts" on storage.objects;
drop policy if exists "Authenticated users can update asset receipts" on storage.objects;
drop policy if exists "Authenticated users can delete asset receipts" on storage.objects;

create policy "Scoped users can read asset receipts"
on storage.objects for select to authenticated
using (
  bucket_id = 'asset-receipts'
  and exists (
    select 1 from public.repair_part_receipts rpr
    where rpr.storage_bucket = bucket_id
      and rpr.storage_object_path = name
  )
);
create policy "Scoped users can upload asset receipts"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'asset-receipts'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (public.has_asset_permission('parts.manage') or public.has_asset_permission('purchasing.manage'))
);
create policy "Scoped users can update asset receipts"
on storage.objects for update to authenticated
using (
  bucket_id = 'asset-receipts'
  and exists (
    select 1 from public.repair_part_receipts rpr
    where rpr.storage_bucket = bucket_id and rpr.storage_object_path = name
  )
) with check (bucket_id = 'asset-receipts');
create policy "Scoped users can delete asset receipts"
on storage.objects for delete to authenticated
using (
  bucket_id = 'asset-receipts'
  and exists (
    select 1 from public.repair_part_receipts rpr
    where rpr.storage_bucket = bucket_id and rpr.storage_object_path = name
  )
);

revoke all on table
  public.system_roles,
  public.permissions,
  public.role_permissions,
  public.user_profiles,
  public.user_permission_overrides,
  public.user_company_access,
  public.user_asset_group_access,
  public.user_access_audit
from anon, authenticated;

grant select on table
  public.system_roles,
  public.permissions,
  public.role_permissions,
  public.user_profiles,
  public.user_permission_overrides,
  public.user_company_access,
  public.user_asset_group_access,
  public.user_access_audit
to authenticated;

revoke insert on table public.asset_activity from authenticated;
revoke insert on table public.asset_audit_log from authenticated;

revoke all on function
  public.is_active_asset_user(uuid),
  public.is_asset_super_admin(uuid),
  public.has_asset_permission(text, uuid),
  public.can_access_asset_company(uuid, uuid),
  public.can_access_asset_group(uuid, uuid),
  public.can_access_asset_record(uuid, uuid),
  public.user_access_snapshot(uuid),
  public.current_asset_user_access(),
  public.admin_set_asset_user_access(uuid, uuid, text, text, text, boolean, boolean, boolean, uuid[], uuid[], jsonb),
  public.admin_record_asset_auth_event(uuid, uuid, text, jsonb, jsonb),
  public.bootstrap_asset_super_admin(text),
  public.authorize_direct_asset_update(),
  public.authorize_repair_update(),
  public.authorize_repair_part_update()
from public, anon, authenticated;

grant execute on function public.is_active_asset_user(uuid) to authenticated;
grant execute on function public.is_asset_super_admin(uuid) to authenticated;
grant execute on function public.has_asset_permission(text, uuid) to authenticated;
grant execute on function public.can_access_asset_company(uuid, uuid) to authenticated;
grant execute on function public.can_access_asset_group(uuid, uuid) to authenticated;
grant execute on function public.can_access_asset_record(uuid, uuid) to authenticated;
grant execute on function public.current_asset_user_access() to authenticated;

-- These two RPCs are invoked only with the Edge Function's server-side service role.
grant execute on function public.admin_set_asset_user_access(
  uuid, uuid, text, text, text, boolean, boolean, boolean, uuid[], uuid[], jsonb
) to service_role;
grant execute on function public.admin_record_asset_auth_event(
  uuid, uuid, text, jsonb, jsonb
) to service_role;

-- Intentionally do not grant bootstrap_asset_super_admin. Run it once as the
-- database owner from the SQL editor after the first Auth account exists.

commit;
