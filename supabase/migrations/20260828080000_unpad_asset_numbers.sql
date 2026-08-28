-- ---------------------------------------------------------------------------
-- Asset numbers run unpadded: AST-1, AST-2, and on up.
--
-- 20260828000000 was applied while its formatter still padded the counter to
-- four digits, so the database has been issuing AST-0016. Editing that file
-- now changes nothing — it is already recorded as applied — so the formatter
-- is replaced here, and anything it has already issued is renumbered the way
-- 20260828010000 did for the numbers that came before it.
--
-- The counter itself does not move: only how it is written.
-- ---------------------------------------------------------------------------

create or replace function public.format_asset_number(p_value bigint)
returns text
language sql
immutable
as $$ select 'AST-' || p_value::text $$;

do $$
declare
  v_clash text;
begin
  -- Nothing is renamed if two assets would end up sharing a number. Better to
  -- stop with the pair named than to fail halfway through the register.
  with renamed as (
    select
      id,
      btrim(asset_number) as old_number,
      'AST-' || regexp_replace(btrim(asset_number), '^AST-0+', '', 'i') as new_number
    from public.assets
    where btrim(asset_number) ~* '^AST-0[0-9]*$'
      and btrim(asset_number) !~* '^AST-0+$'
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
      'Renumbering would put two assets on the same number: %. Give one of each pair a different number first, then run this again.',
      v_clash;
  end if;
end
$$;

-- Rewriting how every number is spelled is one administrative act on the
-- register, not a change to each asset, so it is not written into every
-- asset's history. The triggers are back on at the end of the same transaction.
alter table public.assets disable trigger user;

update public.assets
set asset_number = 'AST-' || regexp_replace(btrim(asset_number), '^AST-0+', '', 'i')
where btrim(asset_number) ~* '^AST-0[0-9]*$'
  and btrim(asset_number) !~* '^AST-0+$';

alter table public.assets enable trigger user;

select setval(
  'public.asset_number_seq',
  coalesce((select max(public.asset_number_value(asset_number)) from public.assets), 0) + 1,
  false
);
