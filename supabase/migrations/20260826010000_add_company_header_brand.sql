-- The workspace brand
--
-- One company can be marked as the mark the workspace wears in its top bar.
-- It is an organisation-wide choice, not a per-user one: whoever may manage
-- companies sets it on everyone's behalf, which is why the check lives in the
-- function below rather than in the client.
--
-- A user scoped to exactly one company never reaches this flag - the client
-- shows them their own company's mark instead, because that is the register
-- they are actually working in.

alter table public.companies
  add column if not exists is_header_brand boolean not null default false;

comment on column public.companies.is_header_brand is
  'True for the single company whose logo brands the workspace top bar. Enforced to at most one row by companies_single_header_brand_uq.';

-- A partial unique index on a constant: at most one row may carry the flag,
-- which is the invariant the UI assumes when it looks the brand up.
create unique index if not exists companies_single_header_brand_uq
  on public.companies ((true))
  where is_header_brand;

-- Setting the brand is two writes - clear the old one, set the new - and they
-- have to land together or the unique index above rejects the second. Done in
-- one function so it is a single transaction with the permission check on the
-- server side, where it cannot be skipped.
create or replace function public.set_company_header_brand(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_asset_permission('companies.manage') then
    raise exception 'You do not have permission to change the workspace brand.'
      using errcode = '42501';
  end if;

  update public.companies set is_header_brand = false where is_header_brand;

  if p_company_id is not null then
    update public.companies set is_header_brand = true where id = p_company_id;
    if not found then
      raise exception 'That company is no longer on the register.' using errcode = 'P0002';
    end if;
  end if;
end;
$$;

revoke all on function public.set_company_header_brand(uuid) from public;
grant execute on function public.set_company_header_brand(uuid) to authenticated;

comment on function public.set_company_header_brand(uuid) is
  'Marks one company as the workspace brand, clearing any previous one. Pass null to leave the workspace unbranded.';
