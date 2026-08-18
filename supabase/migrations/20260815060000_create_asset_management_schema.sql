begin;

-- Asset Management System persistence model.
--
-- UI workflow mapping:
--   Settings              -> companies, asset_categories, project_locations
--   Register/Edit/Retire  -> assets + asset_activity + asset_audit_log
--   Transfer/Custody      -> asset_transfers (also updates the asset's current placement)
--   Repair board          -> repair_tickets + repair_parts + receipt metadata
--   Maintenance           -> maintenance_schedules + maintenance_completions
--   General trail         -> asset_activity (semantic events)
--   Forensic history      -> asset_audit_log (automatic old/new row snapshots)
--   Reports               -> asset_current_availability + asset_financial_summary
--
-- The UI's project/location value "X" is represented by a null
-- project_location_id while current_address keeps the typed address.

create extension if not exists pgcrypto with schema extensions;

create type public.asset_status as enum ('active', 'repair', 'retired');
create type public.repair_stage as enum ('broken', 'parts', 'ongoing', 'testing', 'closed');
create type public.repair_outcome as enum ('returned_to_service', 'retired');
create type public.repair_part_state as enum ('needed', 'ordered', 'purchased');
create type public.maintenance_interval_unit as enum ('days', 'weeks', 'months', 'years');

create sequence public.repair_ticket_number_seq start with 1;

create or replace function public.next_repair_ticket_number()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'RPR-' || lpad(nextval('public.repair_ticket_number_seq')::text, 4, '0');
$$;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  short_code text,
  contact_person text,
  address text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid()
);

create unique index companies_name_ci_uq on public.companies (lower(btrim(name)));
create unique index companies_short_code_ci_uq
  on public.companies (lower(btrim(short_code)))
  where short_code is not null and btrim(short_code) <> '';

create table public.asset_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid()
);

create unique index asset_categories_name_ci_uq
  on public.asset_categories (lower(btrim(name)));

create table public.project_locations (
  id uuid primary key default gen_random_uuid(),
  project_code text not null check (btrim(project_code) <> '' and upper(btrim(project_code)) <> 'X'),
  address text not null check (btrim(address) <> ''),
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  constraint project_locations_coordinate_pair_chk check (
    (latitude is null and longitude is null)
    or
    (latitude between -90 and 90 and longitude between -180 and 180)
  )
);

create unique index project_locations_code_ci_uq
  on public.project_locations (lower(btrim(project_code)));

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  asset_number text not null check (btrim(asset_number) <> ''),
  asset_code text,
  company_id uuid references public.companies(id) on delete restrict,
  category_id uuid references public.asset_categories(id) on delete restrict,
  project_location_id uuid references public.project_locations(id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  serial_number text,
  engine_number text,
  plate_number text,
  mv_file_number text,
  conduction_sticker text,
  body_number text,
  status public.asset_status not null default 'active',
  current_address text not null check (btrim(current_address) <> ''),
  current_custodian text not null check (btrim(current_custodian) <> ''),
  acquired_on date,
  acquisition_cost numeric(14, 2) check (acquisition_cost is null or acquisition_cost >= 0),
  notes text,
  retired_on date,
  retirement_reason text,
  retirement_details text,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid()
);

create unique index assets_asset_number_ci_uq on public.assets (lower(btrim(asset_number)));
create unique index assets_asset_code_ci_uq on public.assets (lower(btrim(asset_code)))
  where asset_code is not null and btrim(asset_code) <> '';
create unique index assets_serial_number_ci_uq on public.assets (lower(btrim(serial_number)))
  where serial_number is not null and btrim(serial_number) <> '';
create unique index assets_engine_number_ci_uq on public.assets (lower(btrim(engine_number)))
  where engine_number is not null and btrim(engine_number) <> '';
create unique index assets_plate_number_ci_uq on public.assets (lower(btrim(plate_number)))
  where plate_number is not null and btrim(plate_number) <> '';
create unique index assets_mv_file_number_ci_uq on public.assets (lower(btrim(mv_file_number)))
  where mv_file_number is not null and btrim(mv_file_number) <> '';
create unique index assets_conduction_sticker_ci_uq on public.assets (lower(btrim(conduction_sticker)))
  where conduction_sticker is not null and btrim(conduction_sticker) <> '';
create unique index assets_body_number_ci_uq on public.assets (lower(btrim(body_number)))
  where body_number is not null and btrim(body_number) <> '';
create index assets_company_idx on public.assets (company_id);
create index assets_category_idx on public.assets (category_id);
create index assets_project_location_idx on public.assets (project_location_id);
create index assets_status_idx on public.assets (status);

create table public.asset_transfers (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  from_project_location_id uuid references public.project_locations(id) on delete set null,
  to_project_location_id uuid references public.project_locations(id) on delete set null,
  from_address text,
  to_address text not null check (btrim(to_address) <> ''),
  from_custodian text,
  to_custodian text not null check (btrim(to_custodian) <> ''),
  effective_on date not null default current_date,
  reason text,
  reference text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  constraint asset_transfers_changes_something_chk check (
    from_address is null
    or to_project_location_id is distinct from from_project_location_id
    or to_address is distinct from from_address
    or to_custodian is distinct from from_custodian
  )
);

create index asset_transfers_asset_date_idx
  on public.asset_transfers (asset_id, effective_on desc, created_at desc);

create table public.repair_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null default public.next_repair_ticket_number(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  stage public.repair_stage not null default 'broken',
  outcome public.repair_outcome,
  fault text not null check (btrim(fault) <> ''),
  reported_by_name text,
  service_provider text,
  hold_address text,
  reported_on date not null default current_date,
  target_completion_on date,
  technician_name text,
  started_on date,
  work_done text,
  repair_completed_on date,
  test_result text,
  labor_cost numeric(14, 2) not null default 0 check (labor_cost >= 0),
  other_cost numeric(14, 2) not null default 0 check (other_cost >= 0),
  return_address text,
  returned_to_name text,
  closed_on date,
  closure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  constraint repair_tickets_closed_state_chk check (
    (stage = 'closed' and closed_on is not null and outcome is not null)
    or
    (stage <> 'closed' and closed_on is null and outcome is null)
  ),
  constraint repair_tickets_closed_details_chk check (
    stage <> 'closed'
    or (outcome = 'returned_to_service'
        and nullif(btrim(return_address), '') is not null
        and nullif(btrim(returned_to_name), '') is not null)
    or (outcome = 'retired' and nullif(btrim(closure_reason), '') is not null)
  ),
  constraint repair_tickets_date_order_chk check (
    (target_completion_on is null or target_completion_on >= reported_on)
    and (started_on is null or started_on >= reported_on)
    and (repair_completed_on is null or repair_completed_on >= reported_on)
    and (closed_on is null or closed_on >= reported_on)
  )
);

create unique index repair_tickets_number_ci_uq
  on public.repair_tickets (lower(btrim(ticket_number)));
create unique index repair_tickets_one_open_per_asset_uq
  on public.repair_tickets (asset_id)
  where stage <> 'closed';
create index repair_tickets_asset_date_idx
  on public.repair_tickets (asset_id, reported_on desc);
create index repair_tickets_stage_idx on public.repair_tickets (stage) where stage <> 'closed';

create table public.repair_parts (
  id uuid primary key default gen_random_uuid(),
  repair_ticket_id uuid not null references public.repair_tickets(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  state public.repair_part_state not null default 'needed',
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  estimated_amount numeric(14, 2) check (estimated_amount is null or estimated_amount >= 0),
  unit_price numeric(14, 2) check (unit_price is null or unit_price >= 0),
  line_total numeric(16, 2) generated always as (quantity * coalesce(unit_price, 0)) stored,
  supplier text,
  needed_on date not null default current_date,
  ordered_on date,
  purchased_on date,
  order_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  constraint repair_parts_state_date_chk check (
    (state = 'needed')
    or (state = 'ordered' and ordered_on is not null)
    or (state = 'purchased' and purchased_on is not null)
  )
);

create index repair_parts_ticket_state_idx
  on public.repair_parts (repair_ticket_id, state);

create table public.repair_part_receipts (
  id uuid primary key default gen_random_uuid(),
  repair_part_id uuid not null references public.repair_parts(id) on delete cascade,
  storage_bucket text not null default 'asset-receipts' check (storage_bucket = 'asset-receipts'),
  storage_object_path text not null check (btrim(storage_object_path) <> ''),
  original_filename text not null check (btrim(original_filename) <> ''),
  mime_type text not null check (btrim(mime_type) <> ''),
  size_bytes bigint not null check (size_bytes >= 0),
  receipt_number text,
  receipt_date date,
  replaced_receipt_id uuid references public.repair_part_receipts(id) on delete set null,
  removed_at timestamptz,
  removed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid()
);

create unique index repair_part_receipts_path_uq
  on public.repair_part_receipts (storage_bucket, storage_object_path);
create unique index repair_part_receipts_one_current_uq
  on public.repair_part_receipts (repair_part_id)
  where removed_at is null;

create table public.maintenance_schedules (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  repeat_every integer not null default 1 check (repeat_every > 0),
  interval_unit public.maintenance_interval_unit not null,
  next_due_on date not null,
  last_completed_on date,
  service_provider text,
  estimated_cost numeric(14, 2) check (estimated_cost is null or estimated_cost >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid()
);

create index maintenance_schedules_due_idx on public.maintenance_schedules (next_due_on);
create index maintenance_schedules_asset_idx on public.maintenance_schedules (asset_id);

create table public.maintenance_completions (
  id uuid primary key default gen_random_uuid(),
  maintenance_schedule_id uuid not null references public.maintenance_schedules(id) on delete cascade,
  completed_on date not null default current_date,
  cost numeric(14, 2) not null default 0 check (cost >= 0),
  service_provider text,
  reference text,
  notes text,
  next_due_on date not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  constraint maintenance_completions_next_due_chk check (next_due_on >= completed_on)
);

create index maintenance_completions_schedule_date_idx
  on public.maintenance_completions (maintenance_schedule_id, completed_on desc);

create table public.asset_activity (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  repair_ticket_id uuid references public.repair_tickets(id) on delete set null,
  repair_part_id uuid references public.repair_parts(id) on delete set null,
  maintenance_schedule_id uuid references public.maintenance_schedules(id) on delete set null,
  maintenance_completion_id uuid references public.maintenance_completions(id) on delete set null,
  transfer_id uuid references public.asset_transfers(id) on delete set null,
  event_type text not null check (btrim(event_type) <> ''),
  event_date date not null default current_date,
  title text not null check (btrim(title) <> ''),
  details text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete set null default auth.uid()
);

create index asset_activity_asset_date_idx
  on public.asset_activity (asset_id, event_date desc, created_at desc);
create index asset_activity_repair_ticket_idx on public.asset_activity (repair_ticket_id)
  where repair_ticket_id is not null;
create index asset_activity_event_type_idx on public.asset_activity (event_type);

create table public.asset_audit_log (
  id bigint primary key generated always as identity,
  table_name text not null,
  record_id uuid not null,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  old_row jsonb,
  new_row jsonb,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id) on delete set null default auth.uid()
);

create index asset_audit_log_record_idx
  on public.asset_audit_log (table_name, record_id, changed_at desc);
create index asset_audit_log_changed_at_idx on public.asset_audit_log (changed_at desc);

comment on table public.asset_activity is
  'Immutable semantic timeline used by General trail, Repairs, Transfers, and Maintenance history.';
comment on table public.asset_audit_log is
  'Automatic immutable old/new snapshots for every mutation of a core business record.';
comment on column public.assets.project_location_id is
  'Null means the UI value X: the asset is not assigned to a configured project/location.';
comment on column public.repair_part_receipts.storage_object_path is
  'Path in the private asset-receipts Supabase Storage bucket; file bytes do not belong in PostgreSQL.';

create or replace function public.set_asset_updated_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by, old.updated_by);
  return new;
end;
$$;

create or replace function public.set_asset_created_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function public.set_asset_creator()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function public.set_asset_activity_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.actor_id := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function public.set_receipt_remover()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.removed_at is null and new.removed_at is not null and auth.uid() is not null then
    new.removed_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function public.prepare_asset_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status is distinct from new.status and not (
    (old.status = 'active' and new.status in ('repair', 'retired'))
    or (old.status = 'repair' and new.status in ('active', 'retired'))
    or (old.status = 'retired' and new.status = 'active')
  ) then
    raise exception 'Invalid asset status transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;

  if old.status is distinct from new.status
     and new.status = 'repair'
     and not exists (
       select 1
       from public.repair_tickets
       where asset_id = new.id and stage <> 'closed'
     ) then
    raise exception 'An asset cannot enter repair status without an open repair ticket'
      using errcode = '23514';
  end if;

  if old.status is distinct from new.status
     and new.status in ('active', 'retired')
     and exists (
       select 1
       from public.repair_tickets
       where asset_id = new.id and stage <> 'closed'
     ) then
    raise exception 'Close the open repair ticket before changing the asset to %', new.status
      using errcode = '23514';
  end if;

  if old.status is distinct from new.status and new.status = 'retired' then
    new.retired_on := coalesce(new.retired_on, current_date);
  end if;

  new.revision := old.revision + 1;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by, old.updated_by);
  return new;
end;
$$;

create or replace function public.validate_repair_ticket_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.stage is distinct from new.stage and not (
    (old.stage = 'broken' and new.stage in ('parts', 'ongoing', 'closed'))
    or (old.stage = 'parts' and new.stage in ('ongoing', 'closed'))
    or (old.stage = 'ongoing' and new.stage in ('parts', 'testing', 'closed'))
    or (old.stage = 'testing' and new.stage in ('ongoing', 'closed'))
  ) then
    raise exception 'Invalid repair stage transition: % -> %', old.stage, new.stage
      using errcode = '23514';
  end if;

  if old.stage is distinct from new.stage and new.stage = 'ongoing' then
    new.started_on := coalesce(new.started_on, current_date);
  elsif old.stage is distinct from new.stage and new.stage = 'testing' then
    new.repair_completed_on := coalesce(new.repair_completed_on, current_date);
  elsif old.stage is distinct from new.stage and new.stage = 'closed' then
    new.closed_on := coalesce(new.closed_on, current_date);
    if new.outcome is null then
      raise exception 'A closed repair ticket requires an outcome'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.validate_repair_part_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.state is distinct from new.state and not (
    (old.state = 'needed' and new.state in ('ordered', 'purchased'))
    or (old.state = 'ordered' and new.state = 'purchased')
  ) then
    raise exception 'Invalid repair part state transition: % -> %', old.state, new.state
      using errcode = '23514';
  end if;

  if old.state is distinct from new.state and new.state = 'ordered' then
    new.ordered_on := coalesce(new.ordered_on, current_date);
  elsif old.state is distinct from new.state and new.state = 'purchased' then
    new.purchased_on := coalesce(new.purchased_on, current_date);
  end if;

  return new;
end;
$$;

create or replace function public.audit_asset_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.asset_audit_log (table_name, record_id, operation, new_row, changed_by)
    values (tg_table_name, new.id, tg_op, to_jsonb(new), auth.uid());
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.asset_audit_log (table_name, record_id, operation, old_row, new_row, changed_by)
    values (tg_table_name, new.id, tg_op, to_jsonb(old), to_jsonb(new), auth.uid());
    return new;
  else
    insert into public.asset_audit_log (table_name, record_id, operation, old_row, changed_by)
    values (tg_table_name, old.id, tg_op, to_jsonb(old), auth.uid());
    return old;
  end if;
end;
$$;

create or replace function public.record_asset_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.asset_activity (asset_id, event_type, event_date, title, details, actor_id)
  values (
    new.id,
    'asset_registered',
    coalesce(new.acquired_on, current_date),
    'Asset registered',
    'Registered at ' || new.current_address || ', under ' || new.current_custodian,
    auth.uid()
  );

  insert into public.asset_transfers (
    asset_id,
    to_project_location_id,
    to_address,
    to_custodian,
    effective_on,
    reason,
    created_by
  ) values (
    new.id,
    new.project_location_id,
    new.current_address,
    new.current_custodian,
    coalesce(new.acquired_on, current_date),
    'First placement on registration',
    auth.uid()
  );
  return new;
end;
$$;

create or replace function public.record_asset_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_name text;
  event_title text;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'retired' then
    event_name := 'asset_retired';
    event_title := 'Asset retired';
  elsif old.status = 'retired' and new.status = 'active' then
    event_name := 'asset_reinstated';
    event_title := 'Asset returned to service';
  elsif new.status = 'repair' then
    event_name := 'asset_sent_for_repair';
    event_title := 'Asset marked for repair';
  else
    event_name := 'asset_returned_to_service';
    event_title := 'Asset returned to service';
  end if;

  insert into public.asset_activity (asset_id, event_type, event_date, title, details, actor_id)
  values (
    new.id,
    event_name,
    case when new.status = 'retired' then coalesce(new.retired_on, current_date) else current_date end,
    event_title,
    coalesce(new.retirement_reason, new.retirement_details),
    auth.uid()
  );
  return new;
end;
$$;

create or replace function public.record_asset_details_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if row(
    old.asset_number, old.asset_code, old.company_id, old.category_id, old.name,
    old.serial_number, old.engine_number, old.plate_number, old.mv_file_number,
    old.conduction_sticker, old.body_number, old.acquired_on,
    old.acquisition_cost, old.notes
  ) is distinct from row(
    new.asset_number, new.asset_code, new.company_id, new.category_id, new.name,
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

create or replace function public.apply_asset_transfer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A row with no source is the registration placement; the asset already
  -- carries that placement, so avoid an unnecessary revision increment.
  if new.from_address is not null
     or new.from_custodian is not null
     or new.from_project_location_id is not null then
    update public.assets
    set project_location_id = new.to_project_location_id,
        current_address = new.to_address,
        current_custodian = new.to_custodian
    where id = new.asset_id;
  end if;

  insert into public.asset_activity (
    asset_id, transfer_id, event_type, event_date, title, details, metadata, actor_id
  ) values (
    new.asset_id,
    new.id,
    'asset_transferred',
    new.effective_on,
    'Asset transferred',
    coalesce(new.reason, new.reference),
    jsonb_build_object(
      'from_project_location_id', new.from_project_location_id,
      'to_project_location_id', new.to_project_location_id,
      'from_address', new.from_address,
      'to_address', new.to_address,
      'from_custodian', new.from_custodian,
      'to_custodian', new.to_custodian,
      'reference', new.reference
    ),
    auth.uid()
  );
  return new;
end;
$$;

create or replace function public.sync_repair_ticket_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  asset_row public.assets;
begin
  if tg_op = 'INSERT' then
    select * into asset_row
    from public.assets
    where id = new.asset_id
    for update;

    if nullif(btrim(new.hold_address), '') is not null
       and new.hold_address is distinct from asset_row.current_address then
      insert into public.asset_transfers (
        asset_id,
        from_project_location_id,
        to_project_location_id,
        from_address,
        to_address,
        from_custodian,
        to_custodian,
        effective_on,
        reason,
        reference,
        created_by
      ) values (
        new.asset_id,
        asset_row.project_location_id,
        asset_row.project_location_id,
        asset_row.current_address,
        new.hold_address,
        asset_row.current_custodian,
        asset_row.current_custodian,
        new.reported_on,
        'Sent out for repair - ' || new.fault,
        new.ticket_number,
        auth.uid()
      );
    end if;

    update public.assets
    set status = 'repair'
    where id = new.asset_id;

    insert into public.asset_activity (
      asset_id, repair_ticket_id, event_type, event_date, title, details, metadata, actor_id
    ) values (
      new.asset_id,
      new.id,
      'fault_reported',
      new.reported_on,
      'Reported broken - ' || new.fault,
      new.reported_by_name,
      jsonb_build_object('ticket_number', new.ticket_number, 'provider', new.service_provider),
      auth.uid()
    );
    return new;
  end if;

  if old.stage is distinct from new.stage then
    if new.stage = 'closed' and new.outcome = 'returned_to_service' then
      select * into asset_row
      from public.assets
      where id = new.asset_id
      for update;

      if new.return_address is distinct from asset_row.current_address
         or new.returned_to_name is distinct from asset_row.current_custodian then
        insert into public.asset_transfers (
          asset_id,
          from_project_location_id,
          to_project_location_id,
          from_address,
          to_address,
          from_custodian,
          to_custodian,
          effective_on,
          reason,
          reference,
          created_by
        ) values (
          new.asset_id,
          asset_row.project_location_id,
          asset_row.project_location_id,
          asset_row.current_address,
          new.return_address,
          asset_row.current_custodian,
          new.returned_to_name,
          new.closed_on,
          'Released after repair',
          new.ticket_number,
          auth.uid()
        );
      end if;

      update public.assets
      set status = 'active'
      where id = new.asset_id;
    elsif new.stage = 'closed' and new.outcome = 'retired' then
      update public.assets
      set status = 'retired',
          retired_on = new.closed_on,
          retirement_reason = coalesce(new.closure_reason, 'Beyond repair')
      where id = new.asset_id;
    end if;

    insert into public.asset_activity (
      asset_id, repair_ticket_id, event_type, event_date, title, details, metadata, actor_id
    ) values (
      new.asset_id,
      new.id,
      'repair_stage_changed',
      coalesce(new.closed_on, new.repair_completed_on, new.started_on, current_date),
      'Repair moved from ' || old.stage::text || ' to ' || new.stage::text,
      coalesce(new.work_done, new.test_result, new.closure_reason),
      jsonb_build_object('from_stage', old.stage, 'to_stage', new.stage, 'outcome', new.outcome),
      auth.uid()
    );
  end if;

  if old.labor_cost is distinct from new.labor_cost
     or old.other_cost is distinct from new.other_cost then
    insert into public.asset_activity (
      asset_id, repair_ticket_id, event_type, event_date, title, metadata, actor_id
    ) values (
      new.asset_id,
      new.id,
      'repair_cost_updated',
      current_date,
      'Repair labour and charges updated',
      jsonb_build_object('labor_cost', new.labor_cost, 'other_cost', new.other_cost),
      auth.uid()
    );
  end if;

  return new;
end;
$$;

create or replace function public.record_repair_part_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_row public.repair_parts;
  ticket public.repair_tickets;
  event_name text;
begin
  if tg_op = 'DELETE' then
    source_row := old;
  else
    source_row := new;
  end if;
  select * into ticket from public.repair_tickets where id = source_row.repair_ticket_id;

  -- During an asset/ticket cascade the parent ticket may already be gone.
  -- The automatic audit log still captures the deletion, so skip only the
  -- semantic activity row that can no longer reference an asset.
  if ticket.id is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    event_name := 'repair_part_added';
  elsif tg_op = 'DELETE' then
    event_name := 'repair_part_deleted';
  elsif old.state is distinct from new.state and new.state = 'ordered' then
    event_name := 'repair_part_ordered';
  elsif old.state is distinct from new.state and new.state = 'purchased' then
    event_name := 'repair_part_purchased';
  else
    event_name := 'repair_part_updated';
  end if;

  insert into public.asset_activity (
    asset_id, repair_ticket_id, repair_part_id, event_type, event_date, title, metadata, actor_id
  ) values (
    ticket.asset_id,
    ticket.id,
    case when tg_op = 'DELETE' then null else source_row.id end,
    event_name,
    coalesce(source_row.purchased_on, source_row.ordered_on, source_row.needed_on, current_date),
    initcap(replace(event_name, '_', ' ')) || ': ' || source_row.name,
    jsonb_build_object(
      'part_id', source_row.id,
      'state', source_row.state,
      'quantity', source_row.quantity,
      'unit_price', source_row.unit_price,
      'supplier', source_row.supplier
    ),
    auth.uid()
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.record_receipt_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  part public.repair_parts;
  ticket public.repair_tickets;
  event_name text;
begin
  select * into part from public.repair_parts where id = new.repair_part_id;
  select * into ticket from public.repair_tickets where id = part.repair_ticket_id;
  event_name := case
    when tg_op = 'INSERT' and new.replaced_receipt_id is not null then 'receipt_replaced'
    when tg_op = 'INSERT' then 'receipt_attached'
    when old.removed_at is null and new.removed_at is not null then 'receipt_removed'
    else 'receipt_updated'
  end;

  insert into public.asset_activity (
    asset_id, repair_ticket_id, repair_part_id, event_type, event_date, title, metadata, actor_id
  ) values (
    ticket.asset_id,
    ticket.id,
    part.id,
    event_name,
    coalesce(new.receipt_date, current_date),
    initcap(replace(event_name, '_', ' ')) || ' for ' || part.name,
    jsonb_build_object(
      'receipt_id', new.id,
      'filename', new.original_filename,
      'receipt_number', new.receipt_number,
      'storage_object_path', new.storage_object_path
    ),
    auth.uid()
  );
  return new;
end;
$$;

create or replace function public.record_maintenance_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.asset_activity (
    asset_id, maintenance_schedule_id, event_type, event_date, title, details, metadata, actor_id
  ) values (
    new.asset_id,
    new.id,
    'maintenance_scheduled',
    current_date,
    'Maintenance scheduled - ' || new.name,
    new.notes,
    jsonb_build_object(
      'repeat_every', new.repeat_every,
      'interval_unit', new.interval_unit,
      'next_due_on', new.next_due_on,
      'provider', new.service_provider,
      'estimated_cost', new.estimated_cost
    ),
    auth.uid()
  );
  return new;
end;
$$;

create or replace function public.apply_maintenance_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  schedule public.maintenance_schedules;
begin
  update public.maintenance_schedules
  set last_completed_on = new.completed_on,
      next_due_on = new.next_due_on
  where id = new.maintenance_schedule_id
  returning * into schedule;

  if schedule.id is null then
    raise exception 'Maintenance schedule % does not exist', new.maintenance_schedule_id;
  end if;

  insert into public.asset_activity (
    asset_id, maintenance_schedule_id, maintenance_completion_id,
    event_type, event_date, title, details, metadata, actor_id
  ) values (
    schedule.asset_id,
    schedule.id,
    new.id,
    'maintenance_completed',
    new.completed_on,
    'Maintenance completed - ' || schedule.name,
    new.notes,
    jsonb_build_object(
      'cost', new.cost,
      'provider', new.service_provider,
      'reference', new.reference,
      'next_due_on', new.next_due_on
    ),
    auth.uid()
  );
  return new;
end;
$$;

create trigger assets_prepare_update
before update on public.assets
for each row execute function public.prepare_asset_update();

create trigger repair_tickets_validate_transition
before update on public.repair_tickets
for each row execute function public.validate_repair_ticket_transition();

create trigger repair_parts_validate_transition
before update on public.repair_parts
for each row execute function public.validate_repair_part_transition();

create trigger repair_part_receipts_set_remover
before update on public.repair_part_receipts
for each row execute function public.set_receipt_remover();

create trigger asset_transfers_set_creator
before insert on public.asset_transfers
for each row execute function public.set_asset_creator();

create trigger maintenance_completions_set_creator
before insert on public.maintenance_completions
for each row execute function public.set_asset_creator();

create trigger asset_activity_set_actor
before insert on public.asset_activity
for each row execute function public.set_asset_activity_actor();

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'companies',
    'asset_categories',
    'project_locations',
    'assets',
    'repair_tickets',
    'repair_parts',
    'repair_part_receipts',
    'maintenance_schedules'
  ] loop
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.set_asset_created_metadata()',
      relation_name || '_set_created_metadata',
      relation_name
    );
  end loop;
end;
$$;

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'companies',
    'asset_categories',
    'project_locations',
    'repair_tickets',
    'repair_parts',
    'repair_part_receipts',
    'maintenance_schedules'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_asset_updated_metadata()',
      relation_name || '_set_updated_metadata',
      relation_name
    );
  end loop;
end;
$$;

create trigger assets_record_registration
after insert on public.assets
for each row execute function public.record_asset_registration();

create trigger assets_record_status_change
after update of status on public.assets
for each row execute function public.record_asset_status_change();

create trigger assets_record_details_change
after update on public.assets
for each row execute function public.record_asset_details_change();

create trigger asset_transfers_apply
after insert on public.asset_transfers
for each row execute function public.apply_asset_transfer();

create trigger repair_tickets_sync_workflow
after insert or update on public.repair_tickets
for each row execute function public.sync_repair_ticket_workflow();

create trigger repair_parts_record_activity
after insert or update or delete on public.repair_parts
for each row execute function public.record_repair_part_activity();

create trigger repair_part_receipts_record_activity
after insert or update on public.repair_part_receipts
for each row execute function public.record_receipt_activity();

create trigger maintenance_schedules_record_activity
after insert on public.maintenance_schedules
for each row execute function public.record_maintenance_schedule();

create trigger maintenance_completions_apply
after insert on public.maintenance_completions
for each row execute function public.apply_maintenance_completion();

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'companies',
    'asset_categories',
    'project_locations',
    'assets',
    'asset_transfers',
    'repair_tickets',
    'repair_parts',
    'repair_part_receipts',
    'maintenance_schedules',
    'maintenance_completions'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_asset_row()',
      relation_name || '_audit_row',
      relation_name
    );
  end loop;
end;
$$;

create view public.asset_current_availability
with (security_invoker = true)
as
select
  a.id as asset_id,
  a.asset_number,
  a.name,
  a.status as asset_status,
  r.id as open_repair_ticket_id,
  r.ticket_number as open_repair_ticket_number,
  r.stage as repair_stage,
  case
    when a.status = 'retired' then 'retired'
    when r.stage is not null then r.stage::text
    else 'active'
  end as availability_key,
  case
    when a.status = 'retired' then 'Retired'
    when r.stage = 'broken' then 'For repair'
    when r.stage = 'parts' then 'Awaiting parts'
    when r.stage = 'ongoing' then 'Ongoing repair'
    when r.stage = 'testing' then 'Under testing'
    else 'Active'
  end as availability_label
from public.assets a
left join public.repair_tickets r
  on r.asset_id = a.id and r.stage <> 'closed';

create view public.asset_financial_summary
with (security_invoker = true)
as
with repair_base as (
  select asset_id, sum(labor_cost + other_cost) as labor_and_other
  from public.repair_tickets
  group by asset_id
),
part_totals as (
  select
    t.asset_id,
    sum(p.line_total) as all_parts,
    sum(p.line_total) filter (where p.state = 'purchased') as purchased_parts,
    sum(p.line_total) filter (where p.state = 'ordered') as ordered_parts
  from public.repair_tickets t
  join public.repair_parts p on p.repair_ticket_id = t.id
  group by t.asset_id
),
maintenance_totals as (
  select s.asset_id, sum(c.cost) as maintenance_cost
  from public.maintenance_schedules s
  join public.maintenance_completions c on c.maintenance_schedule_id = s.id
  group by s.asset_id
)
select
  a.id as asset_id,
  a.asset_number,
  a.name,
  a.acquisition_cost,
  coalesce(rb.labor_and_other, 0)::numeric(16, 2) as repair_labor_and_other,
  coalesce(pt.all_parts, 0)::numeric(16, 2) as all_repair_parts,
  coalesce(pt.purchased_parts, 0)::numeric(16, 2) as purchased_repair_parts,
  coalesce(pt.ordered_parts, 0)::numeric(16, 2) as ordered_repair_parts,
  (coalesce(rb.labor_and_other, 0) + coalesce(pt.all_parts, 0))::numeric(16, 2) as repair_cost,
  coalesce(mt.maintenance_cost, 0)::numeric(16, 2) as maintenance_cost,
  (
    coalesce(rb.labor_and_other, 0)
    + coalesce(pt.all_parts, 0)
    + coalesce(mt.maintenance_cost, 0)
  )::numeric(16, 2) as total_upkeep
from public.assets a
left join repair_base rb on rb.asset_id = a.id
left join part_totals pt on pt.asset_id = a.id
left join maintenance_totals mt on mt.asset_id = a.id;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'asset-receipts',
  'asset-receipts',
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

create policy "Authenticated users can read asset receipts"
on storage.objects for select
to authenticated
using (bucket_id = 'asset-receipts');

create policy "Authenticated users can upload asset receipts"
on storage.objects for insert
to authenticated
with check (bucket_id = 'asset-receipts');

create policy "Authenticated users can update asset receipts"
on storage.objects for update
to authenticated
using (bucket_id = 'asset-receipts')
with check (bucket_id = 'asset-receipts');

create policy "Authenticated users can delete asset receipts"
on storage.objects for delete
to authenticated
using (bucket_id = 'asset-receipts');

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'companies',
    'asset_categories',
    'project_locations',
    'assets',
    'asset_transfers',
    'repair_tickets',
    'repair_parts',
    'repair_part_receipts',
    'maintenance_schedules',
    'maintenance_completions',
    'asset_activity',
    'asset_audit_log'
  ] loop
    execute format('alter table public.%I enable row level security', relation_name);
  end loop;
end;
$$;

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'companies',
    'asset_categories',
    'project_locations',
    'assets',
    'repair_tickets',
    'repair_parts',
    'repair_part_receipts',
    'maintenance_schedules'
  ] loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      relation_name || '_authenticated_manage',
      relation_name
    );
  end loop;
end;
$$;

create policy asset_transfers_authenticated_read
on public.asset_transfers for select to authenticated using (true);
create policy asset_transfers_authenticated_insert
on public.asset_transfers for insert to authenticated with check (true);

create policy maintenance_completions_authenticated_read
on public.maintenance_completions for select to authenticated using (true);
create policy maintenance_completions_authenticated_insert
on public.maintenance_completions for insert to authenticated with check (true);

create policy asset_activity_authenticated_read
on public.asset_activity for select to authenticated using (true);
create policy asset_activity_authenticated_insert
on public.asset_activity for insert to authenticated with check (true);

create policy asset_audit_log_authenticated_read
on public.asset_audit_log for select to authenticated using (true);

revoke all on table
  public.companies,
  public.asset_categories,
  public.project_locations,
  public.assets,
  public.asset_transfers,
  public.repair_tickets,
  public.repair_parts,
  public.repair_part_receipts,
  public.maintenance_schedules,
  public.maintenance_completions,
  public.asset_activity,
  public.asset_audit_log
from anon;

grant select, insert, update, delete on table
  public.companies,
  public.asset_categories,
  public.project_locations,
  public.assets,
  public.repair_parts,
  public.maintenance_schedules
to authenticated;

grant select, insert, update on table
  public.repair_tickets,
  public.repair_part_receipts
to authenticated;

grant select, insert on table
  public.asset_transfers,
  public.maintenance_completions,
  public.asset_activity
to authenticated;

grant select on table public.asset_audit_log to authenticated;
grant select on public.asset_current_availability, public.asset_financial_summary to authenticated;
grant usage, select on sequence public.repair_ticket_number_seq to authenticated;
grant execute on function public.next_repair_ticket_number() to authenticated;

revoke all on function
  public.set_asset_updated_metadata(),
  public.set_asset_created_metadata(),
  public.set_asset_creator(),
  public.set_asset_activity_actor(),
  public.set_receipt_remover(),
  public.prepare_asset_update(),
  public.validate_repair_ticket_transition(),
  public.validate_repair_part_transition(),
  public.audit_asset_row(),
  public.record_asset_registration(),
  public.record_asset_status_change(),
  public.record_asset_details_change(),
  public.apply_asset_transfer(),
  public.sync_repair_ticket_workflow(),
  public.record_repair_part_activity(),
  public.record_receipt_activity(),
  public.record_maintenance_schedule(),
  public.apply_maintenance_completion()
from public, anon, authenticated;

insert into public.asset_categories (name)
values
  ('Computer and IT Equipment'),
  ('Heavy Equipment'),
  ('Machinery and Equipment'),
  ('Tools'),
  ('Office Equipment and Furniture'),
  ('Trucks'),
  ('Service Vehicle Class A'),
  ('Service Vehicle Class B'),
  ('Service Motorcycle'),
  ('Laboratory Equipment'),
  ('Surveying Equipment')
on conflict do nothing;

commit;
