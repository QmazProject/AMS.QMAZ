-- ---------------------------------------------------------------------------
-- The CODE row on the Equipment Repair Order: where the repair took place.
--
-- The paper has three cells - Field, Yard, Contracted outside - and a check
-- mark goes in one of them. It is written by hand on the record here, so it
-- is free text: the printed sheet ticks the cell the text names and writes
-- anything else out as typed.
--
-- Added after 20260916020000 had already been applied, which is why it is
-- its own migration rather than a column in that file.
-- ---------------------------------------------------------------------------

alter table public.maintenance_records
  add column if not exists repair_place text;

comment on column public.maintenance_records.repair_place is
  'Where the repair took place, as the form''s CODE row has it: Field, Yard, Contracted outside, or whatever was written.';
