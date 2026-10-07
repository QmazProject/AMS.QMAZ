-- ---------------------------------------------------------------------------
-- No resequencing over a register that holds numbers the system did not issue.
--
-- Changing the asset numbering sequence rewrites every register-issued number
-- (AST- followed by digits) in the new width. A number in any other shape,
-- whether imported or typed by hand, cannot be rewritten, and 20260916000000
-- quietly left such numbers alone. That is not safe to rely on: a register
-- with OLD-PC-2020-55 or PC001 on it would end up half in one style and half
-- in another, with nothing telling the admin so.
--
-- The save is now refused outright while any such number exists, before a
-- single row is written, and the refusal names how many there are and shows
-- a few of them so they can be corrected first. The check is here, on the
-- server, so the client cannot skip it. Blank numbers are not a case: the
-- column is not null and checked non-blank since the schema was created.
--
-- Transfer numbers are a bigint column and cannot hold a free-text value, so
-- they need no such check and are not touched.
-- ---------------------------------------------------------------------------

-- The numbers that are not in the supported shape, counted and sampled. Not
-- granted to anyone: it reads every asset on the register, so only the
-- resequencing function below, which has already checked for a super admin,
-- may call it.
create or replace function public.unsupported_asset_numbers(
  out unsupported_count bigint,
  out examples text[]
)
returns record
language sql
stable
security definer
set search_path = ''
as $$
  with unsupported as (
    select btrim(asset_number) as asset_number
    from public.assets
    where public.asset_number_value(asset_number) is null
  )
  select
    (select count(*) from unsupported),
    (select coalesce(array_agg(asset_number order by asset_number), '{}')
       from (select asset_number from unsupported order by asset_number limit 5) sample)
$$;

revoke all on function public.unsupported_asset_numbers() from public;

comment on function public.unsupported_asset_numbers() is
  'How many asset numbers are outside the AST-digits shape the register issues, with up to five examples. Internal to set_numbering_sequence.';

create or replace function public.set_numbering_sequence(
  p_kind text,
  p_start bigint,
  p_end bigint,
  p_width integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seq text;
  v_last bigint;
  v_called boolean;
  v_next bigint;
  v_max bigint;
  v_clash text;
  v_unsupported bigint;
  v_examples text[];
begin
  if not public.is_asset_super_admin() then
    raise exception 'Only a super admin can change the numbering sequences.'
      using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('asset', 'transfer') then
    raise exception 'Unknown numbering sequence "%".', coalesce(p_kind, '') using errcode = '22023';
  end if;
  if p_start is null or p_start < 1 then
    raise exception 'The start of the sequence must be 1 or higher.' using errcode = '22023';
  end if;
  if p_end is null or p_end < p_start then
    raise exception 'The end of the sequence must not be lower than its start.' using errcode = '22023';
  end if;
  if p_end > 999999999999999 then
    raise exception 'The end of the sequence can have at most 15 digits.' using errcode = '22023';
  end if;
  if p_width is null or p_width < 1 or p_width > 15 then
    raise exception 'A number can be padded to at most 15 digits.' using errcode = '22023';
  end if;

  if p_kind = 'asset' then
    -- Before anything is written: every number on the register must be one
    -- the system can rewrite, or the change is refused with the offenders
    -- named. errcode 23514 (check_violation) marks it as a data problem the
    -- admin has to fix, not a bad argument.
    select unsupported_count, examples into v_unsupported, v_examples
    from public.unsupported_asset_numbers();
    if v_unsupported > 0 then
      raise exception
        'Cannot update asset numbering sequence. % existing asset % not use the supported AST numbering format. Examples: %. Correct these asset tags first, then try again.',
        v_unsupported,
        case when v_unsupported = 1 then 'tag does' else 'tags do' end,
        array_to_string(v_examples, ', ')
        using errcode = '23514';
    end if;

    v_seq := 'public.asset_number_seq';
    select max(public.asset_number_value(asset_number)) into v_max from public.assets;
  else
    v_seq := 'public.asset_transfer_number_seq';
    select max(transfer_number) into v_max from public.asset_transfers;
  end if;

  if v_max is not null and v_max > p_end then
    raise exception 'The register already holds a number above %: the highest issued so far is %. Choose an end at or above it.',
      lpad(p_end::text, greatest(p_width, length(p_end::text)), '0'),
      lpad(v_max::text, greatest(p_width, length(v_max::text)), '0')
      using errcode = '22023';
  end if;

  insert into public.numbering_sequences as n (kind, start_value, end_value, pad_width, updated_at, updated_by)
  values (p_kind, p_start, p_end, p_width, now(), auth.uid())
  on conflict (kind) do update
    set start_value = excluded.start_value,
        end_value = excluded.end_value,
        pad_width = excluded.pad_width,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;

  -- Up to the start if it is behind, never back.
  execute format('select last_value, is_called from %s', v_seq) into v_last, v_called;
  v_next := case when v_called then v_last + 1 else v_last end;
  if v_next < p_start then
    perform setval(v_seq, p_start, false);
  end if;

  if p_kind <> 'asset' then
    return;
  end if;

  -- Nothing is renamed if two assets would end up sharing a number. Better to
  -- stop with the pair named than to fail halfway through the register.
  with renamed as (
    select
      id,
      btrim(asset_number) as old_number,
      public.format_asset_number(public.asset_number_value(asset_number)) as new_number
    from public.assets
    where public.asset_number_value(asset_number) is not null
      and btrim(asset_number) <> public.format_asset_number(public.asset_number_value(asset_number))
  ),
  clashes as (
    select r.old_number, r.new_number
    from renamed r
    join public.assets a
      on lower(btrim(a.asset_number)) = lower(r.new_number)
     and a.id <> r.id
    union
    select r.old_number, r.new_number
    from renamed r
    where (select count(*) from renamed x where lower(x.new_number) = lower(r.new_number)) > 1
  )
  select string_agg(old_number || ' would become ' || new_number, ', ' order by old_number)
    into v_clash
  from clashes;

  if v_clash is not null then
    raise exception
      'Renumbering would put two assets on the same number: %. Give one of each pair a different number first, then save again.',
      v_clash
      using errcode = '23505';
  end if;

  -- Rewriting how every number is spelled is one administrative act on the
  -- register, not an edit to each asset, so it is not written into every
  -- asset's history. The triggers are back on at the end of the same
  -- transaction. Only asset_number changes; no other column is touched.
  alter table public.assets disable trigger user;

  update public.assets
  set asset_number = public.format_asset_number(public.asset_number_value(asset_number))
  where public.asset_number_value(asset_number) is not null
    and btrim(asset_number) <> public.format_asset_number(public.asset_number_value(asset_number));

  alter table public.assets enable trigger user;
end
$$;

revoke all on function public.set_numbering_sequence(text, bigint, bigint, integer) from public;
grant execute on function public.set_numbering_sequence(text, bigint, bigint, integer) to authenticated;

comment on function public.set_numbering_sequence(text, bigint, bigint, integer) is
  'Super admin only. Sets where a numbering series starts and ends and how wide it is padded; moves the counter up to the start; for assets, refuses while any asset number is outside the AST-digits shape, then rewrites every register-issued AST number in the new width.';
