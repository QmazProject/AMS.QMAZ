-- The workspace header colour
--
-- A company can carry its own colour, and the workspace top bar wears it
-- alongside the company's logo. Stored as a plain hex string rather than
-- separate channels because that is what the colour input hands back and what
-- CSS takes, so nothing has to reassemble it on either side.

alter table public.companies
  add column if not exists theme_color text;

alter table public.companies
  drop constraint if exists companies_theme_color_hex;

alter table public.companies
  add constraint companies_theme_color_hex
  check (theme_color is null or theme_color ~ '^#[0-9a-fA-F]{6}$');

comment on column public.companies.theme_color is
  'Six digit hex, e.g. #1f3a5f, worn by the workspace top bar when this company brands it. Null leaves the header its default black.';
