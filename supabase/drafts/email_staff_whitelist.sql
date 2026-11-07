-- DRAFT: apply after email_account_profile.sql. No whitelist rows are changed.
-- Roll back by restoring the dvc_role body from 202611030001_club_app.sql.
begin;

create or replace function public.dvc_role(p_org uuid, p_user uuid)
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select w.role
    from public.staff_email_whitelist w
    join auth.users u on lower(u.email) = w.email
    where w.organization_id = p_org
      and w.enabled
      and u.id = p_user
      and u.email_confirmed_at is not null
      and exists (
        select 1 from auth.identities i
        where i.user_id = u.id
          and lower(i.identity_data->>'email') = w.email
          and (
            (i.provider = 'google' and i.identity_data->>'email_verified' = 'true')
            or (i.provider = 'email' and u.confirmation_sent_at is not null
                and u.email_confirmed_at >= u.confirmation_sent_at)
          )
      )
  ), 'player');
$$;

revoke all on function public.dvc_role(uuid, uuid) from public, anon, authenticated;
grant execute on function public.dvc_role(uuid, uuid) to service_role;

commit;
