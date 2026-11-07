-- Apply after the M5 drafts and email_staff_whitelist.sql.
-- Roll back callers first, then drop these functions and indexes. Keep role changes.
begin;

create index m6_bookings_directory on public.bookings(organization_id, user_id)
  where user_id is not null;
-- Hosted migrations leave the Supabase-managed Auth indexes in place.

create function public.dvc_management_users(
  p_org uuid, p_user uuid, p_query text, p_role text, p_after text, p_limit integer
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if dvc_role(p_org, p_user) not in ('developer', 'admin') then
    raise insufficient_privilege using message = 'Access denied';
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'Invalid page size';
  end if;

  return (
    with account_ids as (
      select user_id from player_profiles where organization_id = p_org
      union
      select user_id from bookings where organization_id = p_org and user_id is not null
      union
      select u.id from staff_email_whitelist w
      join auth.users u on lower(u.email) = w.email
      where w.organization_id = p_org
    ), accounts as (
      select distinct on (lower(u.email)) lower(u.email) as email, u.id, u.email_confirmed_at,
        coalesce(nullif(p.name, ''), nullif(u.raw_user_meta_data->>'full_name', ''), '') as name
      from account_ids a join auth.users u on u.id = a.user_id
      left join player_profiles p on p.organization_id = p_org and p.user_id = u.id
      where u.email is not null
      order by lower(u.email), u.email_confirmed_at desc nulls last, u.id
    ), access as (
      select w.email, w.id, w.role, w.enabled, w.xmin::text as version
      from staff_email_whitelist w where w.organization_id = p_org
    ), directory as (
      select coalesce(a.email, w.email) collate "C" as email, coalesce(a.name, '') as name,
        a.id is not null as registered, a.email_confirmed_at is not null as verified,
        case when a.id is null and w.enabled then w.role
             when a.id is null then 'player' else dvc_role(p_org, a.id) end as role,
        w.id as access_id, w.role as access_role, w.enabled as access_enabled, w.version
      from accounts a full join access w on w.email = a.email
    ), page as (
      select * from directory
      where (p_after is null or email > p_after)
        and (p_role = '' or role = p_role)
        and (strpos(lower(email), lower(p_query)) > 0 or strpos(lower(name), lower(p_query)) > 0)
      order by email
      limit p_limit + 1
    )
    select coalesce(jsonb_agg(to_jsonb(page) order by email), '[]'::jsonb) from page
  );
end;
$$;

-- Compare the token under the same organization lock used by the existing
-- access.save action. The legacy action retains its role, last-admin and audit rules.
create function public.dvc_management_access_save(
  p_org uuid, p_user uuid, p_data jsonb, p_ref uuid
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_id uuid;
  current_version text;
begin
  perform 1 from organizations where id = p_org for update;
  if dvc_role(p_org, p_user) not in ('developer', 'admin') then
    raise insufficient_privilege using message = 'Access denied';
  end if;

  select w.id, w.xmin::text into current_id, current_version
  from staff_email_whitelist w
  where w.organization_id = p_org and w.email = lower(trim(p_data->>'email'));

  if not (p_data ? 'expected_version')
    or current_id is distinct from (p_data->>'id')::uuid
    or current_version is distinct from p_data->>'expected_version'
  then
    raise exception 'Access changed. Close the editor, refresh Users, and try again';
  end if;

  return dvc_admin(p_org, p_user, 'access.save', p_data - 'expected_version', p_ref);
end;
$$;

revoke all on function public.dvc_management_users(uuid,uuid,text,text,text,integer),
  public.dvc_management_access_save(uuid,uuid,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.dvc_management_users(uuid,uuid,text,text,text,integer),
  public.dvc_management_access_save(uuid,uuid,jsonb,uuid) to service_role;

commit;
