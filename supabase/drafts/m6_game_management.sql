-- Apply after M6 and the M5 game operation drafts. Read-only RPCs.
-- Roll back app callers before dropping the functions and index.
begin;

create index m6_games_management_order on public.games(organization_id, starts_at, id);

create function public.dvc_staff_games(
  p_org uuid, p_user uuid, p_query text, p_venue text, p_status text,
  p_from timestamptz, p_to timestamptz, p_anchor timestamptz, p_desc boolean,
  p_after_time timestamptz, p_after_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  staff_role text := dvc_role(p_org, p_user);
begin
  if staff_role not in ('developer','admin','coordinator','facilitator') then
    raise insufficient_privilege using message = 'Access denied';
  end if;

  return (
    with page as materialized (
      select g.id, g.venue, g.city, g.starts_at, g.ends_at, g.status, g.team_price
      from games g
      where g.organization_id = p_org
        and (staff_role <> 'facilitator' or g.status <> 'draft')
        and (p_status is null or
          (p_status = 'upcoming' and g.status = 'published' and g.ends_at > p_anchor) or
          g.status = p_status)
        and (p_from is null or g.starts_at >= p_from)
        and (p_to is null or g.starts_at < p_to)
        and (p_venue = '' or case when left(p_venue, 3) = 'id:'
          then g.venue_id = substring(p_venue from 4)::uuid
          else strpos(lower(g.venue), p_venue) > 0 end)
        and (p_query = '' or strpos(lower(concat_ws(' ',g.venue,g.city,g.id::text)), p_query) > 0)
        and (p_after_time is null or
          (p_desc and (g.starts_at,g.id) < (p_after_time,p_after_id)) or
          (not p_desc and (g.starts_at,g.id) > (p_after_time,p_after_id)))
      order by case when p_desc then g.starts_at end desc, case when p_desc then g.id end desc,
        case when not p_desc then g.starts_at end, case when not p_desc then g.id end
      limit 26
    )
    select coalesce(jsonb_agg(to_jsonb(page) || jsonb_build_object(
      'facilitators', dvc_facis(page.id), 'positions', '[]'::jsonb)
      order by case when p_desc then page.starts_at end desc, case when p_desc then page.id end desc,
        case when not p_desc then page.starts_at end, case when not p_desc then page.id end), '[]'::jsonb)
    from page
  );
end;
$$;

create function public.dvc_staff_game_context(p_org uuid,p_user uuid,p_game uuid,p_operation text)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  staff_role text := dvc_role(p_org,p_user);
  game jsonb;
  extra jsonb := '{}'::jsonb;
  game_rows jsonb;
begin
  if staff_role not in ('developer','admin','coordinator')
    or (p_operation in ('payments','edit','cancel') and staff_role not in ('developer','admin'))
    or p_operation is null or p_operation not in ('manual','roster','payments','registrations','edit','cancel','facilitators') then
    raise insufficient_privilege using message = 'Access denied';
  end if;

  select to_jsonb(g) || jsonb_build_object(
    'maps_url',v.maps_url, 'facilitators',dvc_facis(g.id),
    'positions',coalesce((select jsonb_agg(to_jsonb(p)) from game_positions p where p.game_id=g.id),'[]'),
    'held_teams',coalesce((
      select jsonb_agg(distinct r.team)
      from roster_entries r join bookings b on b.id=r.booking_id
      where b.organization_id=p_org and b.game_id=g.id and b.kind='team'
        and b.status='holding' and b.expires_at>now()),'[]'))
  into game
  from games g left join venues v on v.id=g.venue_id and v.organization_id=p_org
  where g.organization_id=p_org and g.id=p_game;
  if game is null then return null; end if;
  game_rows := jsonb_build_array(game);

  if p_operation = 'roster' then
    extra := jsonb_build_object('roster',coalesce((
      select jsonb_agg(to_jsonb(r) || jsonb_build_object('game_id',p_game,'kind',b.kind))
      from roster_entries r join bookings b on b.id=r.booking_id
      where b.organization_id=p_org and b.game_id=p_game and b.status='reserved'),'[]'));
  elsif p_operation in ('registrations','payments') then
    if exists(select 1 from bookings b where b.organization_id=p_org and b.game_id=p_game
      and (p_operation='registrations' or b.status='reserved') offset 1000 limit 1) then
      if p_operation = 'payments' then
        raise exception 'This game has too many payments for this view. Use the Payments list.';
      end if;
      raise exception 'This game has too many registrations for this view. Open Registrations from the game card.';
    end if;
    if p_operation = 'registrations' then
      extra := jsonb_build_object('support',coalesce((select jsonb_agg(jsonb_build_object(
        'id',b.id,'game_id',b.game_id,'captain_name',b.captain_name,'contact',b.contact,'kind',b.kind,'status',b.status)
        order by b.created_at desc,b.id desc) from bookings b where b.organization_id=p_org and b.game_id=p_game),'[]'));
    else
      extra := jsonb_build_object('bookings',coalesce((select jsonb_agg(
        (to_jsonb(b)-'guest_hash'-'user_id'-'quote_snapshot') || jsonb_build_object('receipt',
          (select jsonb_build_object('id',r.id,'review_note',r.review_note) from receipts r where r.booking_id=b.id))
        order by b.created_at desc,b.id desc)
        from bookings b where b.organization_id=p_org and b.game_id=p_game and b.status='reserved'),'[]'),
        'payments',coalesce((select jsonb_agg(to_jsonb(m)) from (
          select id,label,account_name,account_number,enabled from payment_methods
          where organization_id=p_org and enabled order by label,id limit 100
        ) m),'[]'));
      game_rows := game_rows || coalesce((select jsonb_agg(to_jsonb(g)) from (
        select g.id,g.venue,g.starts_at,g.status,v.maps_url
        from games g left join venues v on v.id=g.venue_id and v.organization_id=p_org
        where g.organization_id=p_org and g.id<>p_game and g.status='published' and g.starts_at>now()
        order by g.starts_at,g.id limit 100
      ) g),'[]');
    end if;
  elsif p_operation = 'facilitators' then
    extra := jsonb_build_object('staff',coalesce((select jsonb_agg(to_jsonb(s)) from (
      select u.id,coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email) as name,
        u.email,dvc_role(p_org,u.id) as role
      from staff_email_whitelist w join auth.users u on lower(u.email)=w.email
      where w.organization_id=p_org and w.enabled and dvc_role(p_org,u.id) <> 'player'
      order by u.id limit 100
    ) s),'[]'));
  elsif p_operation = 'edit' then
    extra := jsonb_build_object('venues',coalesce((select jsonb_agg(to_jsonb(v)) from (
      select id,name,city,enabled,maps_url from venues
      where organization_id=p_org and (enabled or id=(game->>'venue_id')::uuid)
      order by (id=(game->>'venue_id')::uuid) desc,name,id limit 100
    ) v),'[]'));
  end if;
  return jsonb_build_object('role',staff_role,'games',game_rows,'roster','[]'::jsonb,
    'limited_options', jsonb_array_length(game_rows) > 100
      or coalesce(jsonb_array_length(extra->'venues'),0) = 100
      or coalesce(jsonb_array_length(extra->'payments'),0) = 100
      or coalesce(jsonb_array_length(extra->'staff'),0) = 100) || extra;
end;
$$;

revoke all on function public.dvc_staff_games(uuid,uuid,text,text,text,timestamptz,timestamptz,timestamptz,boolean,timestamptz,uuid),
  public.dvc_staff_game_context(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.dvc_staff_games(uuid,uuid,text,text,text,timestamptz,timestamptz,timestamptz,boolean,timestamptz,uuid),
  public.dvc_staff_game_context(uuid,uuid,uuid,text) to service_role;

commit;
