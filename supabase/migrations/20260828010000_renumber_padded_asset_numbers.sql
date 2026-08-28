-- ---------------------------------------------------------------------------
-- Bring the assets numbered under the old padded scheme onto the new one:
-- AST-0011 becomes AST-11. The counter itself does not move — only the way it
-- is written — so nothing is renumbered out of order and the register carries
-- on from the same place.
--
-- Only numbers that are plainly padded are touched: AST- followed by a leading
-- zero and digits. A number in any other shape, whether it came from an
-- imported register or was typed by hand, is left exactly as it is.
--
-- Run this after 20260828000000_add_asset_number_sequence.sql.
-- ---------------------------------------------------------------------------

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

-- The audit trail records what someone did to an asset. Rewriting how every
-- number is spelled is one administrative act on the register, not a change to
-- each asset, so it is not written into every asset's history. The triggers are
-- back on at the end of the same transaction.
alter table public.assets disable trigger user;

update public.assets
set asset_number = 'AST-' || regexp_replace(btrim(asset_number), '^AST-0+', '', 'i')
where btrim(asset_number) ~* '^AST-0[0-9]*$'
  and btrim(asset_number) !~* '^AST-0+$';

alter table public.assets enable trigger user;

-- The values did not change, only their spelling, but leave the counter
-- provably in step with what is now on the register.
select setval(
  'public.asset_number_seq',
  coalesce((select max(public.asset_number_value(asset_number)) from public.assets), 0) + 1,
  false
);
