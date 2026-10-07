-- ---------------------------------------------------------------------------
-- Numbering sequences, set from Settings.
--
-- Asset numbers and transfer numbers each come from a database sequence, so
-- everyone reads the same number off the same row. Until now the way those
-- numbers were written was fixed in code: AST-1, AST-2, TR 1, TR 2. A super
-- admin can now choose where a series starts and where it ends, and the width
-- of the start decides how the counter is padded: a start of 000001 issues
-- AST-000001, AST-000002 and on; a start of 1 issues AST-1, AST-2 as before.
--
-- One row per series. The defaults below reproduce exactly what the register
-- does today, so applying this migration changes nothing on its own.
-- ---------------------------------------------------------------------------

create table if not exists public.numbering_sequences (
  kind text primary key check (kind in ('asset', 'transfer')),
  start_value bigint not null check (start_value >= 1),
  end_value bigint not null check (end_value <= 999999999999999),
  pad_width integer not null check (pad_width between 1 and 15),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (end_value >= start_value)
);

comment on table public.numbering_sequences is
  'How the register writes the numbers it issues: one row for asset numbers, one for transfer numbers. The counter itself is the Postgres sequence; this decides where it starts, where it stops, and how many digits it is padded to.';
comment on column public.numbering_sequences.pad_width is
  'Digits the counter is left-padded to with zeros. Taken from the width of the start the admin typed, so 000001 means six digits and 1 means none.';

insert into public.numbering_sequences (kind, start_value, end_value, pad_width)
values ('asset', 1, 999999999999999, 1), ('transfer', 1, 999999999999999, 1)
on conflict (kind) do nothing;

alter table public.numbering_sequences enable row level security;

-- Anyone signed in may read the preference: the client pads the transfer
-- numbers it shows with it. Writing goes through set_numbering_sequence, which
-- checks the caller itself, so no insert or update policy exists on purpose.
drop policy if exists numbering_sequences_active_read on public.numbering_sequences;
create policy numbering_sequences_active_read on public.numbering_sequences
  for select to authenticated using (public.is_active_asset_user());

grant select on public.numbering_sequences to authenticated;

-- The counter as it should be written. A value wider than the padding is
-- written in full: lpad would otherwise cut its leading digits off.
create or replace function public.format_sequence_number(p_kind text, p_value bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lpad(
    p_value::text,
    greatest(coalesce((select n.pad_width from public.numbering_sequences n where n.kind = p_kind), 1), length(p_value::text)),
    '0'
  )
$$;

-- Was immutable while the padding was fixed in code; it now reads the
-- preference, so it is stable. Nothing indexes on it.
create or replace function public.format_asset_number(p_value bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$ select 'AST-' || public.format_sequence_number('asset', p_value) $$;

-- Asset numbers: the generator now honours the start and refuses to go past
-- the end. Everything else is as 20260828000000 left it.
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
  v_value bigint;
  v_start bigint;
  v_end bigint;
  v_tries integer := 0;
begin
  select start_value, end_value into v_start, v_end
  from public.numbering_sequences where kind = 'asset';
  v_start := coalesce(v_start, 1);
  v_end := coalesce(v_end, 999999999999999);

  if new.asset_number is null or btrim(new.asset_number) = '' then
    -- Definer rights on purpose: the number has to be unique across the whole
    -- register, including the companies this user cannot read.
    loop
      -- Look before taking: a number past the end is refused without being
      -- spent, so raising the end later carries on with no gap.
      select last_value, is_called into v_last, v_called from public.asset_number_seq;
      v_next := greatest(case when v_called then v_last + 1 else v_last end, v_start);
      if v_next > v_end then
        raise exception 'Asset numbering has reached the end of its sequence (%). Raise the ending sequence in Settings before registering another asset.',
          public.format_asset_number(v_end)
          using errcode = 'P0001';
      end if;
      v_value := nextval('public.asset_number_seq');
      if v_value < v_start then
        perform setval('public.asset_number_seq', v_start, true);
        v_value := v_start;
      end if;
      v_candidate := public.format_asset_number(v_value);
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

-- What the Register asset form shows before anything is saved. It only looks;
-- the number is not spent until the row is actually inserted.
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
  v_start bigint;
begin
  select last_value, is_called into v_last, v_called from public.asset_number_seq;
  v_next := case when v_called then v_last + 1 else v_last end;
  select start_value into v_start from public.numbering_sequences where kind = 'asset';
  return public.format_asset_number(greatest(
    v_next,
    coalesce(v_start, 1),
    coalesce((select max(public.asset_number_value(asset_number)) from public.assets), 0) + 1
  ));
end
$$;

-- Transfer numbers: same start and end treatment. The number stays a bigint
-- on the row; the padding is applied wherever it is shown.
create or replace function public.set_asset_transfer_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value bigint;
  v_start bigint;
  v_end bigint;
  v_last bigint;
  v_called boolean;
  v_next bigint;
begin
  if new.transfer_number is null
     and (new.from_address is not null
          or new.from_custodian is not null
          or new.from_project_location_id is not null) then
    select start_value, end_value into v_start, v_end
    from public.numbering_sequences where kind = 'transfer';
    v_start := coalesce(v_start, 1);
    v_end := coalesce(v_end, 999999999999999);
    -- Look before taking, so a refused number is not spent.
    select last_value, is_called into v_last, v_called from public.asset_transfer_number_seq;
    v_next := greatest(case when v_called then v_last + 1 else v_last end, v_start);
    if v_next > v_end then
      raise exception 'Transfer numbering has reached the end of its sequence (%). Raise the ending sequence in Settings before recording another transfer.',
        public.format_sequence_number('transfer', v_end)
        using errcode = 'P0001';
    end if;
    v_value := nextval('public.asset_transfer_number_seq');
    if v_value < v_start then
      perform setval('public.asset_transfer_number_seq', v_start, true);
      v_value := v_start;
    end if;
    new.transfer_number := v_value;
  end if;
  return new;
end;
$$;

-- The preview Settings shows for transfers, the way next_asset_number does
-- for assets. Looks only; nothing is spent.
create or replace function public.next_transfer_number()
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_last bigint;
  v_called boolean;
  v_next bigint;
  v_start bigint;
begin
  select last_value, is_called into v_last, v_called from public.asset_transfer_number_seq;
  v_next := case when v_called then v_last + 1 else v_last end;
  select start_value into v_start from public.numbering_sequences where kind = 'transfer';
  return greatest(
    v_next,
    coalesce(v_start, 1),
    coalesce((select max(transfer_number) from public.asset_transfers), 0) + 1
  );
end
$$;

revoke all on function public.next_transfer_number() from public;
grant execute on function public.next_transfer_number() to authenticated;

-- Saving the preference. One function, one transaction, with the permission
-- check on the server where it cannot be skipped:
--
--   * the row is written;
--   * the counter is moved up to the start if it is behind it, and never moved
--     back, so a number already issued is never issued twice;
--   * for assets, every number the register wrote itself (AST- and digits) is
--     rewritten in the new width, the way 20260828010000 and 20260828080000
--     did when the spelling last changed. A number in any other shape, whether
--     imported or typed, is left exactly as it is. Rewriting the spelling is
--     one administrative act on the register, not an edit to each asset, so
--     it is not written into every asset's history.
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
  'Super admin only. Sets where a numbering series starts and ends and how wide it is padded; moves the counter up to the start; for assets, rewrites every register-issued AST number in the new width.';
