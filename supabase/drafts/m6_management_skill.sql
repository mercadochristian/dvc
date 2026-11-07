-- Apply after m6_management_users.sql and unified_registration.sql.
-- Restore the previous dvc_management_users body and remove the new writer after
-- rolling back its callers. Preserve saved profile changes and audit history.
begin;

-- This write depends on checkout rejecting a stale profile snapshot on new
-- holds. Fail before changing the directory on an older checkout schema.
do $$
begin
  if strpos(pg_get_functiondef('public.dvc_checkout_hold(uuid,uuid,text,jsonb,uuid)'::regprocedure),
      'is distinct from saved.level') = 0 then
    raise exception 'Apply the current unified registration hold before management skill editing';
  end if;
end;
$$;

create or replace function public.dvc_management_users(
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
        p.level as profile_level, p.xmin::text as profile_version,
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
        case when a.profile_level is not null then jsonb_build_object(
          'user_id', a.id, 'level', a.profile_level, 'version', a.profile_version
        ) end as skill_profile,
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

create function public.dvc_management_skill_save(
  p_org uuid, p_actor uuid, p_target uuid, p_level text, p_version text, p_ref uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_level text;
  current_version text;
  saved_version text;
begin
  if p_actor is null or coalesce(dvc_role(p_org, p_actor), 'player') not in ('developer', 'admin') then
    raise insufficient_privilege using message = 'Access denied';
  end if;
  if p_target is null or p_level is null
    or p_level not in ('developmental', 'developmental_plus', 'intermediate', 'intermediate_plus', 'advanced')
    or p_version is null or p_version !~ '^[0-9]{1,10}$' then
    raise exception 'Check the skill level and profile version';
  end if;

  -- Take the checkout owner lock first. Checkout inserts can take an FK
  -- key-share lock on the organization, which must not wait on this edit.
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':user:' || p_target::text, 0));
  -- This mode conflicts with access.save's org row lock without blocking FKs.
  perform 1 from organizations where id = p_org for no key update;
  if coalesce(dvc_role(p_org, p_actor), 'player') not in ('developer', 'admin') then
    raise insufficient_privilege using message = 'Access denied';
  end if;

  select p.level, p.xmin::text into current_level, current_version
  from player_profiles p
  where p.organization_id = p_org and p.user_id = p_target
  for update;
  if not found then
    raise exception 'Player profile not found';
  end if;
  if current_version is distinct from p_version then
    raise exception 'Player profile changed. Refresh Users and try again';
  end if;
  if current_level = p_level then
    return jsonb_build_object('user_id', p_target, 'level', current_level, 'version', current_version);
  end if;

  update player_profiles p
  set level = p_level, updated_at = clock_timestamp()
  where p.organization_id = p_org and p.user_id = p_target
  returning p.xmin::text into saved_version;

  perform dvc_event(p_org, p_actor, 'profile.skill.save', p_target, p_ref);
  update developer_events
  set details = jsonb_build_object('previous_level', current_level, 'level', p_level)
  where organization_id = p_org and reference_id = p_ref
    and actor_id = p_actor and kind = 'activity' and action = 'profile.skill.save';

  return jsonb_build_object('user_id', p_target, 'level', p_level, 'version', saved_version);
end;
$$;

revoke all on function public.dvc_management_skill_save(uuid,uuid,uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.dvc_management_skill_save(uuid,uuid,uuid,text,text,uuid) to service_role;

commit;
