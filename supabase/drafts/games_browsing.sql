-- Incremental draft AFTER unified_registration.sql (7e86c29c). Additive, no data rewrites.
begin;
create function public.dvc_public_game(p_org uuid,p_game uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',g.id,'venue_id',g.venue_id,'venue',g.venue,'city',g.city,'maps_url',(select v.maps_url from venues v where v.id=g.venue_id and v.organization_id=p_org),'starts_at',g.starts_at,'ends_at',g.ends_at,'status',g.status,'team_price',coalesce(g.team_discount_price,g.team_price),'regular_team_price',g.team_price,'team_discount_price',g.team_discount_price,'team_count',g.team_count,'available_teams',(select count(*) from generate_series(1,g.team_count) n where not exists(select 1 from roster_entries re join bookings bo on bo.id=re.booking_id where bo.game_id=g.id and re.team=n and (bo.status='reserved' or(bo.status='holding' and bo.expires_at>now())))),'facilitators',(select coalesce(jsonb_agg(jsonb_build_object('name',split_part(x->>'name',' ',1))),'[]') from jsonb_array_elements(dvc_facis(g.id)) x),
  'positions',(select jsonb_agg(jsonb_build_object('position',p.position,'capacity',p.capacity,'price',coalesce(p.discount_price,p.price),'regular_price',p.price,'discount_price',p.discount_price,'available',greatest(0,p.capacity-(select count(*) from roster_entries r join bookings b on b.id=r.booking_id where b.game_id=g.id and r.position=p.position and (b.status='reserved' or (b.status='holding' and b.expires_at>now()))))) order by p.position) from game_positions p where p.game_id=g.id))
 from games g where g.organization_id=p_org and g.id=p_game and g.status<>'draft';
$$;

create function public.dvc_games_browse(p_org uuid,p_anchor timestamptz,p_date date default null,p_venue uuid default null,p_completed boolean default false,p_cancelled boolean default false,p_query text default '',p_position text default null,p_after_bucket integer default null,p_after_start timestamptz default null,p_after_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_anchor is null or not isfinite(p_anchor) or p_anchor>now()+interval '30 seconds' or p_completed is null or p_cancelled is null or p_query is null or length(p_query)>120 or (p_position is not null and p_position not in ('open','opposite','middle','setter')) then raise exception 'Invalid games filters'; end if;
 if (p_after_bucket is null) <> (p_after_start is null) or (p_after_start is null) <> (p_after_id is null) or (p_after_bucket is not null and p_after_bucket not in (0,1)) then raise exception 'Invalid games cursor'; end if;
 return (
 with candidates as (
 select g.id,g.starts_at,case when g.status='published' and g.ends_at>p_anchor then 0 else 1 end as bucket
 from games g
 where g.organization_id=p_org and g.status<>'draft'
 and ((g.status='published' and g.ends_at>p_anchor) or (p_completed and (g.status='completed' or (g.status='published' and g.ends_at<=p_anchor))) or (p_cancelled and g.status='cancelled'))
 and (p_date is null or (g.starts_at>=(p_date::timestamp at time zone 'Asia/Manila') and g.starts_at<((p_date+1)::timestamp at time zone 'Asia/Manila')))
 and (p_venue is null or g.venue_id=p_venue)
 and (p_query='' or position(lower(p_query) in lower(g.venue||' '||g.city))>0)
 and (p_position is null or exists(select 1 from game_positions gp where gp.game_id=g.id and gp.position=p_position and gp.capacity>(select count(*) from roster_entries r join bookings b on b.id=r.booking_id where b.game_id=g.id and r.position=gp.position and (b.status='reserved' or (b.status='holding' and b.expires_at>now())))))
 ), page as materialized (
 select * from candidates c where p_after_bucket is null or c.bucket>p_after_bucket or (c.bucket=p_after_bucket and ((c.bucket=0 and (c.starts_at,c.id)>(p_after_start,p_after_id)) or (c.bucket=1 and (c.starts_at,c.id)<(p_after_start,p_after_id))))
 order by bucket,case when bucket=0 then starts_at end asc,case when bucket=0 then id end asc,case when bucket=1 then starts_at end desc,case when bucket=1 then id end desc limit 13
 ), visible as materialized (
 select * from page order by bucket,case when bucket=0 then starts_at end asc,case when bucket=0 then id end asc,case when bucket=1 then starts_at end desc,case when bucket=1 then id end desc limit 12
 ), last_key as (select * from visible order by bucket desc,case when bucket=0 then starts_at end desc,case when bucket=0 then id end desc,case when bucket=1 then starts_at end asc,case when bucket=1 then id end asc limit 1)
 select jsonb_build_object('games',coalesce((select jsonb_agg(dvc_public_game(p_org,v.id) order by bucket,case when bucket=0 then starts_at end asc,case when bucket=0 then id end asc,case when bucket=1 then starts_at end desc,case when bucket=1 then id end desc) from visible v),'[]'::jsonb),
 'next_key',case when (select count(*) from page)>12 then (select jsonb_build_object('bucket',bucket,'starts_at',starts_at,'id',id) from last_key) else null end)
 );
end $$;

create function public.dvc_game_venues(p_org uuid,p_after uuid default null) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 with candidates as materialized (
 select v.id,v.name,v.city from venues v where v.organization_id=p_org and (p_after is null or v.id>p_after)
 and exists(select 1 from games g where g.organization_id=p_org and g.venue_id=v.id and g.status<>'draft') order by v.id limit 101
 ), visible as materialized (select * from candidates order by id limit 100)
 select jsonb_build_object('venues',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'city',city) order by id) from visible),'[]'::jsonb),
 'next_cursor',case when (select count(*) from candidates)>100 then (select id from visible order by id desc limit 1) else null end);
$$;
create function public.dvc_selected_games(p_org uuid,p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_ids is null or cardinality(p_ids)<1 or cardinality(p_ids)>100 or array_position(p_ids,null) is not null then raise exception 'Choose between 1 and 100 game IDs'; end if;
 return (with requested as (select distinct unnest(p_ids) as id), found as materialized (select g.id,dvc_public_game(p_org,g.id) as game from games g join requested r on r.id=g.id where g.organization_id=p_org and g.status<>'draft')
 select jsonb_build_object('games',coalesce((select jsonb_agg(game order by id) from found),'[]'::jsonb),'missing_ids',coalesce((select jsonb_agg(r.id order by r.id) from requested r where not exists(select 1 from found f where f.id=r.id)),'[]'::jsonb)));
end $$;
revoke all on function public.dvc_public_game(uuid,uuid),public.dvc_games_browse(uuid,timestamptz,date,uuid,boolean,boolean,text,text,integer,timestamptz,uuid),public.dvc_game_venues(uuid,uuid),public.dvc_selected_games(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.dvc_public_game(uuid,uuid),public.dvc_games_browse(uuid,timestamptz,date,uuid,boolean,boolean,text,text,integer,timestamptz,uuid),public.dvc_game_venues(uuid,uuid),public.dvc_selected_games(uuid,uuid[]) to service_role;
commit;
