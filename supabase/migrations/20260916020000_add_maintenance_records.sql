-- ---------------------------------------------------------------------------
-- Historic maintenance records.
--
-- A schedule (maintenance_schedules) is work that is going to recur; this is
-- the record of work that was done: a repair or a preventive maintenance
-- service, written up the way the paper Equipment Repair Order is - who it
-- was assigned to, what failed, who repaired it and for how many hours, the
-- parts and supplies used, any contracted repair, the totals, when it was
-- completed and who signed it off.
--
-- One row per job, against one asset, listed by the date the job started.
-- Parts and supplies are kept as a JSON list on the row: they are the lines
-- of one form, filled in by hand, and are never queried on their own.
--
-- Anyone who may manage maintenance may write a record up; only a super
-- admin may change or delete one afterwards, since it is the register's
-- account of what was done and what it cost.
-- ---------------------------------------------------------------------------

create table if not exists public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  maintenance_type text not null check (maintenance_type in ('repair', 'pms')),
  ero_code text,
  started_on date not null,
  assigned_to text,
  location text,
  failure_cause text,
  mileage_hours text,
  -- details: repaired by, hours for the repair, hours for the P.M.
  repaired_by text,
  repair_hours text,
  pm_hours text,
  -- parts and supplies: [{qty, partNo, description, unitCost, amount}, ...]
  parts jsonb not null default '[]'::jsonb check (jsonb_typeof(parts) = 'array'),
  -- contracted repairs
  contractor_vendor text,
  contractor_address text,
  finished_on date,
  parts_total numeric(14, 2) check (parts_total is null or parts_total >= 0),
  labor_total numeric(14, 2) check (labor_total is null or labor_total >= 0),
  -- completion and sign-off
  completed_on date,
  downtime text,
  mechanic_operator text,
  assistant_supervisor text,
  supervisor text,
  department_head text,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid()
);

comment on table public.maintenance_records is
  'Historic maintenance: one repair or preventive maintenance job written up against an asset, as the Equipment Repair Order form has it. Listed by started_on.';
comment on column public.maintenance_records.parts is
  'Parts and supplies lines as typed on the form: a JSON array of {qty, partNo, description, unitCost, amount}.';

create index if not exists maintenance_records_asset_started_idx
  on public.maintenance_records (asset_id, started_on desc);

drop trigger if exists maintenance_records_set_updated_metadata on public.maintenance_records;
create trigger maintenance_records_set_updated_metadata
  before update on public.maintenance_records
  for each row execute function public.set_asset_updated_metadata();

alter table public.maintenance_records enable row level security;

-- Read and write follow the same scoping as schedules: the asset has to be
-- one the user can see. Update and delete are the super admin's alone.
drop policy if exists maintenance_records_scoped_read on public.maintenance_records;
create policy maintenance_records_scoped_read on public.maintenance_records
for select to authenticated using (
  public.has_asset_permission('maintenance.view') and public.can_access_asset_record(asset_id)
);

drop policy if exists maintenance_records_scoped_insert on public.maintenance_records;
create policy maintenance_records_scoped_insert on public.maintenance_records
for insert to authenticated with check (
  public.has_asset_permission('maintenance.manage') and public.can_access_asset_record(asset_id)
);

drop policy if exists maintenance_records_admin_update on public.maintenance_records;
create policy maintenance_records_admin_update on public.maintenance_records
for update to authenticated using (
  public.is_asset_super_admin() and public.can_access_asset_record(asset_id)
) with check (public.can_access_asset_record(asset_id));

drop policy if exists maintenance_records_admin_delete on public.maintenance_records;
create policy maintenance_records_admin_delete on public.maintenance_records
for delete to authenticated using (
  public.is_asset_super_admin() and public.can_access_asset_record(asset_id)
);

revoke all on table public.maintenance_records from public;
grant select, insert, update, delete on table public.maintenance_records to authenticated;
