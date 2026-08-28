-- ---------------------------------------------------------------------------
-- Asset numbers are issued by the database, not by the browser.
--
-- The register used to work out the next number from the assets it had on
-- screen, which is only the assets the signed-in user is allowed to see. Two
-- people scoped to different companies would therefore both be offered
-- AST-0007, and the second one to save was rejected by the unique index with a
-- raw Postgres message. A sequence is the only counter every user shares, so
-- the number now carries on across the whole register whatever a user's
-- company access happens to be.
--
-- The global unique index assets_asset_number_ci_uq already exists and is left
-- exactly as it is: it remains the guarantee that no two assets can hold the
-- same number, whoever inserts them and however they are inserted.
-- ---------------------------------------------------------------------------

create sequence if not exists public.asset_number_seq as bigint start with 1 minvalue 1;

-- One place that knows what an asset number looks like, so the trigger, the
-- preview and the backfill can never drift apart. The counter is not padded:
-- AST-1, AST-2, and on up.
create or replace function public.format_asset_number(p_value bigint)
returns text
language sql
immutable
as $$ select 'AST-' || p_value::text $$;

-- The counter inside a number, or null for anything not in that shape: an
-- imported register may carry numbers of its own and those must not be parsed.
-- Leading zeros are stripped, so a register that already holds AST-0011 from
-- the padded numbering is read as eleven and the series carries on from there.
create or replace function public.asset_number_value(p_number text)
returns bigint
language sql
immutable
as $$
  select case
    when btrim(coalesce(p_number, '')) ~* '^AST-[0-9]{1,15}$'
      then coalesce(nullif(regexp_replace(btrim(p_number), '^AST-0*', '', 'i'), ''), '0')::bigint
  end
$$;

-- Start the sequence above every number already on the register.
select setval(
  'public.asset_number_seq',
  coalesce((select max(public.asset_number_value(asset_number)) from public.assets), 0) + 1,
  false
);

create or replace function public.set_asset_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate text;
  v_explicit bigint;
  v_last bigint;
  v_called boolean;
  v_next bigint;
  v_tries integer := 0;
begin
  if new.asset_number is null or btrim(new.asset_number) = '' then
    -- Definer rights on purpose: the number has to be unique across the whole
    -- register, including the companies this user cannot read.
    loop
      v_candidate := public.format_asset_number(nextval('public.asset_number_seq'));
      exit when not exists (
        select 1 from public.assets where lower(btrim(asset_number)) = lower(v_candidate)
      );
      v_tries := v_tries + 1;
      if v_tries > 1000 then
        raise exception 'Could not find a free asset number after 1000 attempts';
      end if;
    end loop;
    new.asset_number := v_candidate;
    return new;
  end if;

  -- A number supplied by hand or by the Excel import is kept, and the counter
  -- is pushed past it so the generator can never hand it out a second time.
  new.asset_number := btrim(new.asset_number);
  v_explicit := public.asset_number_value(new.asset_number);
  if v_explicit is not null then
    select last_value, is_called into v_last, v_called from public.asset_number_seq;
    v_next := case when v_called then v_last + 1 else v_last end;
    if v_explicit >= v_next then
      perform setval('public.asset_number_seq', v_explicit + 1, false);
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists assets_set_number on public.assets;
create trigger assets_set_number
  before insert on public.assets
  for each row execute function public.set_asset_number();

-- What the Register asset form shows before anything is saved. It only looks;
-- the number is not spent until the row is actually inserted, so a cancelled
-- form leaves no gap in the register.
create or replace function public.next_asset_number()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_last bigint;
  v_called boolean;
  v_next bigint;
begin
  select last_value, is_called into v_last, v_called from public.asset_number_seq;
  v_next := case when v_called then v_last + 1 else v_last end;
  return public.format_asset_number(greatest(
    v_next,
    coalesce((select max(public.asset_number_value(asset_number)) from public.assets), 0) + 1
  ));
end
$$;

revoke all on function public.next_asset_number() from public;
grant execute on function public.next_asset_number() to authenticated;
