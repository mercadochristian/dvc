-- DRAFT M3: apply after game_flow_milestones and booking_confirmation_outbox.
-- Read-only canonical registration review. No checkout/booking/hold writes.
-- M4 adds persistence in a separate draft after the M3 checkpoint.
begin;

create function public.dvc_checkout_review(p_org uuid,p_data jsonb) returns jsonb
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare
 organizer jsonb:=p_data->'organizer'; selection jsonb; player jsonb; normalized jsonb;
 selections jsonb:='[]'::jsonb; players jsonb; seen uuid[]:='{}'; g games;
 game_id uuid; pos text; occupied integer; needed integer; capacity integer; unit_price integer;
 prices jsonb; snapshot jsonb; game_total bigint; total bigint:=0; named text;
 registrants integer; plays boolean; kind text; map_url text; profile jsonb;
begin
 if jsonb_typeof(p_data) is distinct from 'object' or jsonb_typeof(organizer) is distinct from 'object'
  or jsonb_typeof(organizer->'name') is distinct from 'string' or jsonb_typeof(organizer->'contact') is distinct from 'string'
  or length(trim(coalesce(organizer->>'name',''))) not between 1 and 100
  or length(trim(coalesce(organizer->>'contact',''))) not between 3 and 160 then raise exception 'Check organizer name and contact'; end if;
 perform (p_data->>'request_id')::uuid;
 if p_data->>'request_id' is null then raise exception 'Check request ID'; end if;
 if dvc_optional_email(organizer->>'email') is null then raise exception 'Enter the organizer email'; end if;
 if jsonb_typeof(p_data->'games') is distinct from 'array' or jsonb_array_length(p_data->'games')=0 then raise exception 'Select at least one game'; end if;
 for selection in select value from jsonb_array_elements(p_data->'games') loop
  if jsonb_typeof(selection) is distinct from 'object' then raise exception 'Check game selection'; end if;
  game_id:=(selection->>'game_id')::uuid;
  if game_id=any(seen) then raise exception 'Select each game only once'; end if;
  seen:=array_append(seen,game_id);
  select * into g from games where id=game_id and organization_id=p_org;
  if not found or g.status<>'published' or g.starts_at<=clock_timestamp() then raise exception 'A selected game is closed. Review your games'; end if;
  kind:=selection->>'kind';
  if kind is null or kind not in ('individual','group','team') then raise exception 'Choose individual, group, or team'; end if;
  if jsonb_typeof(selection->'organizer_plays') is distinct from 'boolean' then raise exception 'Choose organizer participation'; end if;
  plays:=(selection->>'organizer_plays')::boolean;
  if jsonb_typeof(selection->'players') is distinct from 'array' then raise exception 'Check the player slots'; end if;
  needed:=jsonb_array_length(selection->'players');
  if kind='individual' and needed<>1 then raise exception 'Individual registration needs one player'; end if;
  if kind='group' and needed not between 2 and 5 then raise exception 'Group registration needs 2–5 players'; end if;
  if kind='team' and needed<>6 then raise exception 'Team registration needs six players'; end if;
  registrants:=0; players:='[]'::jsonb;
  for player in select value from jsonb_array_elements(selection->'players') loop
   if jsonb_typeof(player) is distinct from 'object' or coalesce(player->>'position','') not in ('open','opposite','middle','setter') then raise exception 'Choose a player position'; end if;
   if jsonb_typeof(player->'is_registrant') is distinct from 'boolean' then raise exception 'Choose the organizer player slot'; end if;
   if player->'name' is not null and player->'name'<>'null'::jsonb and jsonb_typeof(player->'name')<>'string' then raise exception 'Check player name'; end if;
   named:=nullif(trim(player->>'name'),'');
   normalized:=jsonb_build_object('position',player->>'position','name',named,'is_registrant',(player->>'is_registrant')::boolean,'email',dvc_optional_email(player->>'email'));
   if (player->>'is_registrant')::boolean then
    registrants:=registrants+1;
    if named is distinct from trim(organizer->>'name') then raise exception 'The organizer player must use the organizer name'; end if;
   end if;
   if named is null then
    if kind='individual' or (player->>'is_registrant')::boolean then raise exception 'Enter the player name'; end if;
    if exists(select 1 from jsonb_each(player) e where e.key in ('level','gender','birth_date','first_timer','age','email') and e.value not in ('null'::jsonb,'""'::jsonb)) then raise exception 'Name this player before adding their details'; end if;
   else
    if length(named)>100 then raise exception 'Check player name'; end if;
    profile:=dvc_player_profile(player,(g.starts_at at time zone 'Asia/Manila')::date);
    -- Age is computed for persistence later, never round-tripped as an input
    -- alongside birthday (which intentionally rejects manual age).
    normalized:=normalized||(profile-'age');
   end if;
   players:=players||jsonb_build_array(normalized);
  end loop;
  if registrants<>(case when plays then 1 else 0 end) then raise exception 'Choose exactly one organizer slot when playing'; end if;
  prices:='{}'::jsonb; game_total:=0;
  foreach pos in array array['open','opposite','middle','setter'] loop
   select count(*) into needed from jsonb_array_elements(players) p where p->>'position'=pos;
   if kind='team' and needed<>(case when pos in ('open','middle') then 2 else 1 end) then raise exception 'A team needs 2 Open, 1 Opposite, 2 Middle, and 1 Setter'; end if;
   if needed=0 then continue; end if;
   select p.capacity,coalesce(p.discount_price,p.price) into capacity,unit_price from game_positions p where p.game_id=g.id and p.position=pos;
   if not found then raise exception 'A selected position is no longer available. Review your games'; end if;
   select count(*) into occupied from roster_entries r join bookings b on b.id=r.booking_id where b.game_id=g.id and r.position=pos and (b.status='reserved' or (b.status='holding' and b.expires_at>clock_timestamp()));
   if occupied+needed>capacity then raise exception 'A selected position is no longer available. Review your games'; end if;
   prices:=prices||jsonb_build_object(pos,unit_price);
   game_total:=game_total+needed::bigint*unit_price;
  end loop;
  if kind='team' then
   if dvc_free_team(g.id) is null then raise exception 'No whole team slot is available'; end if;
   game_total:=coalesce(g.team_discount_price,g.team_price);
  end if;
  select v.maps_url into map_url from venues v where v.id=g.venue_id and v.organization_id=p_org;
  snapshot:=jsonb_build_object('venue',g.venue,'city',g.city,'maps_url',map_url,'starts_at',g.starts_at,'ends_at',g.ends_at,'team_price',coalesce(g.team_discount_price,g.team_price),'position_prices',prices);
  selections:=selections||jsonb_build_array(jsonb_build_object('game_id',g.id,'kind',kind,'organizer_plays',plays,'players',players,'amount',game_total,'venue',g.venue,'city',g.city,'maps_url',map_url,'starts_at',g.starts_at,'ends_at',g.ends_at,'quote',snapshot));
  total:=total+game_total;
 end loop;
 return jsonb_build_object('games',selections,'amount',total);
end $$;
revoke all on function public.dvc_checkout_review(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dvc_checkout_review(uuid,jsonb) to service_role;

-- A genuine owned prior registrant is a Returnee even when the saved-profile
-- table was introduced after their booking. Organizer-only history is excluded.
-- A legacy age-only roster is returned without inventing a birthday.
create or replace function public.dvc_profile(p_org uuid,p_user uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'saved',p.user_id is not null,'name',coalesce(p.name,h.name),'contact',coalesce(p.contact,h.contact),'position',coalesce(p.position,h.position),
  'level',coalesce(p.level,h.level),'gender',coalesce(p.gender,h.gender),'birth_date',coalesce(p.birth_date,h.birth_date),
  'age',case when coalesce(p.birth_date,h.birth_date) is null then h.age else null end,
  'first_timer',case when h.id is not null then false else p.first_timer end)
 from (select 1) seed
 left join player_profiles p on p.organization_id=p_org and p.user_id=p_user
 left join lateral (
  select r.id,r.name,r.position,r.level,r.gender,r.birth_date,r.age,b.contact
  from bookings b join roster_entries r on r.booking_id=b.id
  where b.organization_id=p_org and b.user_id=p_user and b.organizer_plays and b.status='reserved' and r.is_registrant
  order by b.created_at desc,r.id limit 1
 ) h on true
 where p_user is not null and (p.user_id is not null or h.id is not null);
$$;
revoke all on function public.dvc_profile(uuid,uuid) from public,anon,authenticated;
grant execute on function public.dvc_profile(uuid,uuid) to service_role;
commit;
