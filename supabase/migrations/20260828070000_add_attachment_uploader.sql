-- ---------------------------------------------------------------------------
-- Who filed the signed form.
--
-- An attachment already records when it arrived; the audit trail also wants to
-- say who put it there. The name is stamped onto the row at insert, for the
-- same reason the transfer recorder is: a user may read only their own profile,
-- so a colleague opening the transfer would otherwise see nothing, and the
-- record should say who filed it at the time whatever happens to that account
-- afterwards.
-- ---------------------------------------------------------------------------

alter table public.asset_transfer_attachments
  add column if not exists uploaded_by_name text;

comment on column public.asset_transfer_attachments.uploaded_by_name is
  'Display name of the account that filed the form, stamped at insert. Shown in the attachment trail.';

create or replace function public.set_transfer_attachment_uploader()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.uploaded_by_name is null or btrim(new.uploaded_by_name) = '' then
    -- definer rights on purpose: a user may read only their own profile row
    select p.full_name into new.uploaded_by_name
    from public.user_profiles p
    where p.user_id = coalesce(new.created_by, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists asset_transfer_attachments_set_uploader on public.asset_transfer_attachments;
create trigger asset_transfer_attachments_set_uploader
  before insert on public.asset_transfer_attachments
  for each row execute function public.set_transfer_attachment_uploader();

update public.asset_transfer_attachments a
set uploaded_by_name = p.full_name
from public.user_profiles p
where p.user_id = a.created_by
  and (a.uploaded_by_name is null or btrim(a.uploaded_by_name) = '');
