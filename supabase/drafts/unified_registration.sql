-- DRAFT: apply after combined_checkout.sql on a verified isolated target.
-- Optional player details and minimum team composition at a flat team price.
-- No backfill, legacy booking, receipt, price or status changes.
begin;

-- NULL preserves the meaning of untouched historical rows; new participants
-- always receive an explicit flag. No profile data is fabricated or backfilled.
alter table public.roster_entries add column if not exists has_details boolean;
alter table public.checkouts alter column organizer_email drop not null;

create or replace function public.dvc_checkout_review(p_org uuid,p_data jsonb) returns jsonb
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare
 organizer jsonb:=p_data->'organizer'; selection jsonb; player jsonb; normalized jsonb;
 selections jsonb:='[]'::jsonb; players jsonb; seen uuid[]:='{}'; g games;
 game_id uuid; pos text; occupied integer; needed integer; capacity integer; unit_price integer;
 prices jsonb; snapshot jsonb; game_total bigint; total bigint:=0; named text;
 registrants integer; plays boolean; has_details boolean; kind text; map_url text; profile jsonb;
begin
 if jsonb_typeof(p_data) is distinct from 'object' or jsonb_typeof(organizer) is distinct from 'object'
  or jsonb_typeof(organizer->'name') is distinct from 'string' or jsonb_typeof(organizer->'contact') is distinct from 'string'
  or length(trim(coalesce(organizer->>'name',''))) not between 1 and 100
  or length(trim(coalesce(organizer->>'contact',''))) not between 3 and 160 then raise exception 'Check organizer name and contact'; end if;
 perform (p_data->>'request_id')::uuid;
 if p_data->>'request_id' is null then raise exception 'Check request ID'; end if;
 if dvc_optional_email(organizer->>'email') is null and
  trim(organizer->>'contact') !~ '^https://(facebook[.]com|www[.]facebook[.]com|m[.]facebook[.]com|messenger[.]com|www[.]messenger[.]com|m[.]me)/[^[:space:]@]+$'
 then raise exception 'Enter an email or a Facebook/Messenger link'; end if;
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
  if kind='team' and needed<6 then raise exception 'Team registration needs at least six players'; end if;
  registrants:=0; players:='[]'::jsonb;
  for player in select value from jsonb_array_elements(selection->'players') loop
   if jsonb_typeof(player) is distinct from 'object' or coalesce(player->>'position','') not in ('open','opposite','middle','setter') then raise exception 'Choose a player position'; end if;
   if jsonb_typeof(player->'is_registrant') is distinct from 'boolean' then raise exception 'Choose the organizer player slot'; end if;
   if player->'name' is not null and player->'name'<>'null'::jsonb and jsonb_typeof(player->'name')<>'string' then raise exception 'Check player name'; end if;
   named:=nullif(trim(player->>'name'),'');
   if jsonb_typeof(player->'has_details') is distinct from 'boolean' then raise exception 'Choose whether to add player details'; end if;
   has_details:=(player->>'has_details')::boolean;
   normalized:=jsonb_build_object('position',player->>'position','name',named,'is_registrant',(player->>'is_registrant')::boolean,'has_details',has_details,'email',dvc_optional_email(player->>'email'));
   if (player->>'is_registrant')::boolean then
    registrants:=registrants+1;
    if has_details and named is distinct from trim(organizer->>'name') then raise exception 'The organizer player must use the organizer name'; end if;
   end if;
   if has_details then
    if named is null then raise exception 'Enter the player name'; end if;
    if length(named)>100 then raise exception 'Check player name'; end if;
    profile:=dvc_player_profile(player,(g.starts_at at time zone 'Asia/Manila')::date);
    normalized:=normalized||(profile-'age');
   else
    if named is not null or exists(select 1 from jsonb_each(player) e where e.key in ('level','gender','birth_date','first_timer','age','email') and e.value not in ('null'::jsonb,'""'::jsonb)) then raise exception 'Clear player details or enable Add player details'; end if;
   end if;
   players:=players||jsonb_build_array(normalized);
  end loop;
  if registrants<>(case when plays then 1 else 0 end) then raise exception 'Choose exactly one organizer slot when playing'; end if;
  prices:='{}'::jsonb; game_total:=0;
  foreach pos in array array['open','opposite','middle','setter'] loop
   select count(*) into needed from jsonb_array_elements(players) p where p->>'position'=pos;
   if kind='team' and needed<(case when pos in ('open','middle') then 2 else 1 end) then raise exception 'A team needs at least 2 Open, 1 Opposite, 2 Middle, and 1 Setter'; end if;
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

create or replace function public.dvc_checkout_hold(p_org uuid,p_user uuid,p_guest text,p_data jsonb,p_ref uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 c checkouts; fingerprint text; owner_value text; game_id uuid; selection jsonb; quoted jsonb; quotes jsonb:='[]';
 conflicts jsonb:='[]'; declined_conflicts jsonb; player jsonb; profile jsonb; booking_id uuid; team_slot integer; assigned_team integer; core_counts jsonb; used integer; required integer; expires timestamptz; amount bigint:=0;
begin
 if p_user is null and (p_guest is null or p_guest !~ '^[a-f0-9]{64}$') then raise exception 'Review your games before continuing'; end if;
 if p_user is not null and p_guest is not null then raise exception 'Account checkout cannot use guest ownership'; end if;
 if jsonb_typeof(p_data->'games') is distinct from 'array' or jsonb_array_length(p_data->'games')=0 then raise exception 'Select at least one game'; end if;
 if p_data->>'request_id' is null then raise exception 'Check request ID'; end if;
 if (select count(distinct (value->>'game_id')::uuid) from jsonb_array_elements(p_data->'games'))<>jsonb_array_length(p_data->'games') then raise exception 'Select each game only once'; end if;
 owner_value:=case when p_user is not null then 'user:'||p_user::text else 'guest:'||p_guest end;
 fingerprint:=encode(sha256(convert_to(p_data::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||owner_value,0));
 select * into c from checkouts x where x.organization_id=p_org and x.owner_key=owner_value and x.request_id=(p_data->>'request_id')::uuid;
 if found then
  if c.request_fingerprint<>fingerprint then return jsonb_build_object('outcome','intent_mismatch','checkout',dvc_checkout_json(c.id)); end if;
  return jsonb_build_object('outcome','existing','checkout',dvc_checkout_json(c.id));
 end if;
 select i.conflicts into declined_conflicts from checkout_declined_intents i where i.organization_id=p_org and i.owner_key=owner_value and i.request_id=(p_data->>'request_id')::uuid;
 if found then return jsonb_build_object('outcome','selection_conflict','conflicts',declined_conflicts); end if;
 -- Check the saved level only for new holds. An unchanged retry above still
 -- returns its original checkout even if the player's profile has changed.
 if p_user is not null and exists (
  select 1 from player_profiles saved
  cross join lateral jsonb_array_elements(p_data->'games') selection(value)
  cross join lateral jsonb_array_elements(selection.value->'players') participant(value)
  where saved.organization_id=p_org and saved.user_id=p_user
   and participant.value->>'is_registrant'='true'
   and participant.value->>'has_details' is distinct from 'false'
   and participant.value->>'level' is distinct from saved.level
 ) then raise exception 'Your saved skill level changed. Reopen registration and try again'; end if;
 -- Every capacity writer locks games; stable ordering avoids cross-game deadlocks.
 for game_id in select distinct (value->>'game_id')::uuid from jsonb_array_elements(p_data->'games') order by 1 loop
  perform 1 from games where id=game_id and organization_id=p_org for update;
 end loop;
 -- All validation/consent conflicts below precede checkout, booking and profile writes.
 for selection in select value from jsonb_array_elements(p_data->'games') loop
  begin
   quoted:=dvc_checkout_review(p_org,jsonb_build_object('request_id',p_data->'request_id','organizer',p_data->'organizer','games',jsonb_build_array(selection)))->'games'->0;
  exception when raise_exception then
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('game_id',selection->'game_id','code','SELECTION_UNAVAILABLE')); continue;
  end;
  if selection->'expected_amount' is distinct from quoted->'amount'
   or selection->'expected_quote'->'position_prices' is distinct from quoted->'quote'->'position_prices'
   or selection->'expected_quote'->'team_price' is distinct from quoted->'quote'->'team_price' then
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('game_id',selection->'game_id','code','PRICE_CHANGED'));
  elsif ((selection->'expected_quote')-'position_prices'-'team_price') is distinct from ((quoted->'quote')-'position_prices'-'team_price') then
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('game_id',selection->'game_id','code','SCHEDULE_CHANGED'));
  end if;
  quotes:=quotes||jsonb_build_array(quoted); amount:=amount+(quoted->>'amount')::bigint;
 end loop;
 if jsonb_array_length(conflicts)>0 then
  insert into checkout_declined_intents(organization_id,owner_key,request_id,request_fingerprint,conflicts) values(p_org,owner_value,(p_data->>'request_id')::uuid,fingerprint,conflicts);
  return jsonb_build_object('outcome','selection_conflict','conflicts',conflicts);
 end if;
 expires:=clock_timestamp()+interval '10 minutes';
 insert into checkouts(organization_id,user_id,guest_hash,request_id,request_fingerprint,organizer_name,contact,organizer_email,amount,expires_at)
 values(p_org,p_user,p_guest,(p_data->>'request_id')::uuid,fingerprint,trim(p_data->'organizer'->>'name'),trim(p_data->'organizer'->>'contact'),dvc_optional_email(p_data->'organizer'->>'email'),amount,expires) returning * into c;
 for quoted in select value from jsonb_array_elements(quotes) loop
  game_id:=(quoted->>'game_id')::uuid;
  team_slot:=case when quoted->>'kind'='team' then dvc_free_team(game_id) else null end;
  if quoted->>'kind'='team' and team_slot is null then raise exception 'No whole team slot is available'; end if;
  insert into bookings(organization_id,game_id,user_id,guest_hash,kind,captain_name,contact,amount,organizer_plays,organizer_email,expires_at,checkout_id,quote_snapshot)
  values(p_org,game_id,p_user,p_guest,quoted->>'kind',c.organizer_name,c.contact,(quoted->>'amount')::int,(quoted->>'organizer_plays')::boolean,c.organizer_email,expires,c.id,quoted->'quote') returning id into booking_id;
  core_counts:='{}'::jsonb;
  for player in select value from jsonb_array_elements(quoted->'players') loop
   -- A pricing team may have additional players, but a court lineup still has
   -- only the original six positions. Extras remain unassigned and consume
   -- their real position capacity through the same booking/hold.
   assigned_team:=null;
   if team_slot is not null then
    used:=coalesce((core_counts->>(player->>'position'))::integer,0);
    required:=case when player->>'position' in ('open','middle') then 2 else 1 end;
    if used<required then
     assigned_team:=team_slot;
     core_counts:=jsonb_set(core_counts,array[player->>'position'],to_jsonb(used+1));
    end if;
   end if;
   profile:=case when player->>'name' is null then '{}'::jsonb else dvc_player_profile(player,((quoted->>'starts_at')::timestamptz at time zone 'Asia/Manila')::date) end;
   insert into roster_entries(booking_id,position,name,team,is_registrant,has_details,level,gender,age,birth_date,first_timer,email)
   values(booking_id,player->>'position',player->>'name',assigned_team,(player->>'is_registrant')::boolean,(player->>'has_details')::boolean,profile->>'level',profile->>'gender',(profile->>'age')::int,(profile->>'birth_date')::date,(profile->>'first_timer')::boolean,
    case when not (player->>'has_details')::boolean then null when (player->>'is_registrant')::boolean then c.organizer_email else dvc_optional_email(player->>'email') end);
   if p_user is not null and (player->>'is_registrant')::boolean and (player->>'has_details')::boolean then
    insert into player_profiles(organization_id,user_id,name,contact,position,level,gender,birth_date,first_timer)
    values(p_org,p_user,c.organizer_name,c.contact,player->>'position',profile->>'level',profile->>'gender',(profile->>'birth_date')::date,(profile->>'first_timer')::boolean)
    on conflict(organization_id,user_id) do update set name=excluded.name,contact=excluded.contact,position=excluded.position,level=excluded.level,gender=excluded.gender,birth_date=excluded.birth_date,first_timer=excluded.first_timer,updated_at=clock_timestamp();
   end if;
  end loop;
 end loop;
 perform dvc_event(p_org,p_user,'checkout.hold',c.id,p_ref);
 return jsonb_build_object('outcome','created','checkout',dvc_checkout_json(c.id));
end $$;

revoke all on function public.dvc_checkout_hold(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.dvc_checkout_hold(uuid,uuid,text,jsonb,uuid) to service_role;

-- Owner-only personal-details editing. Target IDs identify an existing row;
-- capacity, position, team, booking, amount and receipt history are immutable.
create or replace function public.dvc_booking_player_update(p_org uuid,p_user uuid,p_guest text,p_data jsonb,p_ref uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 b bookings; g games; r roster_entries; game_id uuid; booking_id uuid; entry_id uuid;
 details boolean; named text; profile jsonb:='{}'::jsonb; player_email text;
begin
 if p_user is null and (p_guest is null or p_guest !~ '^[a-f0-9]{64}$') then raise exception 'Booking not found'; end if;
 if p_user is not null and p_guest is not null then raise exception 'Account booking cannot use guest ownership'; end if;
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Check player details'; end if;
 if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('booking_id','entry_id','expected_version','has_details','name','email','level','gender','birth_date','first_timer','age')) then raise exception 'Only player details can be changed'; end if;
 -- age:null is the canonical output of the typed profile validator; a supplied
 -- non-null age is never accepted in place of birthday.
 if p_data->'age' is not null and p_data->'age'<>'null'::jsonb then raise exception 'Enter birthday, not age'; end if;
 booking_id:=(p_data->>'booking_id')::uuid; entry_id:=(p_data->>'entry_id')::uuid;
 if booking_id is null or entry_id is null then raise exception 'Booking not found'; end if;
 select bo.game_id into game_id from bookings bo where bo.id=booking_id and bo.organization_id=p_org;
 if not found then raise exception 'Booking not found'; end if;
 -- Match checkout writers' game -> booking -> roster order. Check the actual
 -- locked schedule/status and current clock after every potentially waiting lock.
 select * into g from games where id=game_id and organization_id=p_org for update;
 if not found then raise exception 'Booking not found'; end if;
 select bo.* into b from bookings bo where bo.id=booking_id and bo.organization_id=p_org and bo.game_id=g.id for update;
 if not found then raise exception 'Booking not found'; end if;
 if not (case when b.checkout_id is null then dvc_owned(p_org,p_user,p_guest,b.id) else dvc_checkout_owned(p_org,p_user,p_guest,b.checkout_id) end) then raise exception 'Booking not found'; end if;
 select * into r from roster_entries where id=entry_id and roster_entries.booking_id=b.id for update;
 if not found then raise exception 'Player not found'; end if;
 if jsonb_typeof(p_data->'expected_version') is distinct from 'number' or (p_data->>'expected_version') !~ '^[0-9]+$' then raise exception 'Check player version'; end if;
 if (p_data->>'expected_version')::numeric<>r.version then raise exception 'Player details changed. Refresh before editing again'; end if;
 if g.status<>'published' or b.status not in ('holding','reserved') or (b.status='holding' and b.expires_at<=clock_timestamp()) then raise exception 'This booking cannot be edited'; end if;
 if clock_timestamp()>=g.starts_at-interval '1 hour' then raise exception 'Player details can only be edited until one hour before the game'; end if;
 if jsonb_typeof(p_data->'has_details') is distinct from 'boolean' then raise exception 'Choose whether to add player details'; end if;
 details:=(p_data->>'has_details')::boolean;
 named:=nullif(trim(p_data->>'name'),'');
 player_email:=dvc_optional_email(p_data->>'email');
 if details then
  if jsonb_typeof(p_data->'name') is distinct from 'string' or named is null or length(named)>100 then raise exception 'Enter the player name'; end if;
  if r.is_registrant and named is distinct from b.captain_name then raise exception 'The organizer player must use the organizer name'; end if;
  profile:=dvc_player_profile(p_data,(g.starts_at at time zone 'Asia/Manila')::date);
 else
  if named is not null or exists(select 1 from jsonb_each(p_data) e where e.key in ('level','gender','birth_date','first_timer','age','email') and e.value not in ('null'::jsonb,'""'::jsonb)) then raise exception 'Clear player details or enable Add player details'; end if;
 end if;
 update roster_entries set has_details=details,name=named,email=player_email,level=profile->>'level',gender=profile->>'gender',age=(profile->>'age')::integer,birth_date=(profile->>'birth_date')::date,first_timer=(profile->>'first_timer')::boolean,version=version+1 where id=r.id returning * into r;
 perform dvc_event(p_org,p_user,'booking.player.update',r.id,p_ref);
 return to_jsonb(r);
end $$;
revoke all on function public.dvc_booking_player_update(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.dvc_booking_player_update(uuid,uuid,text,jsonb,uuid) to service_role;
create or replace function public.dvc_checkout_json(p_checkout uuid) returns jsonb
language sql volatile security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',c.id,'request_id',c.request_id,'status',case when c.status='holding' and c.expires_at<=clock_timestamp() then 'expired' else c.status end,
 'payment_status',c.payment_status,'expires_at',c.expires_at,'created_at',c.created_at,'amount',c.amount,
 'receipt',(select jsonb_build_object('id',r.id,'submitted_at',r.submitted_at) from checkout_receipts r where r.checkout_id=c.id),
 'bookings',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'game_id',b.game_id,'checkout_id',c.id,'kind',b.kind,'captain_name',b.captain_name,
  'amount',b.amount,'organizer_plays',b.organizer_plays,'status',case when b.status='holding' and b.expires_at<=clock_timestamp() then 'expired' else b.status end,
  'payment_status',b.payment_status,'expires_at',b.expires_at,'created_at',b.created_at,'venue',g.venue,'maps_url',v.maps_url,'game_status',g.status,'starts_at',g.starts_at,'ends_at',g.ends_at,
  'entries',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from roster_entries e where e.booking_id=b.id),'[]')) order by g.starts_at,b.id)
 from bookings b join games g on g.id=b.game_id left join venues v on v.id=g.venue_id and v.organization_id=c.organization_id where b.checkout_id=c.id),'[]'))
 from checkouts c where c.id=p_checkout;
$$;
create or replace function public.dvc_bookings(p_org uuid,p_user uuid,p_guest text) returns jsonb
language sql volatile security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg((to_jsonb(b)-'guest_hash'-'contact'-'user_id'-'quote_snapshot')||jsonb_build_object(
 'status',case when b.checkout_id is not null and b.status='holding' and b.expires_at<=clock_timestamp() then 'expired' else b.status end,
 'venue',g.venue,'maps_url',v.maps_url,'game_status',g.status,'starts_at',g.starts_at,'ends_at',g.ends_at,
 'review_note',(select review_note from receipts where booking_id=b.id),
 'entries',(select jsonb_agg(to_jsonb(r) order by r.id) from roster_entries r where r.booking_id=b.id))||
 case when c.id is null then '{}'::jsonb else jsonb_build_object('checkout_amount',c.amount,'checkout_status',case when c.status='holding' and c.expires_at<=clock_timestamp() then 'expired' else c.status end,'checkout_payment_status',c.payment_status,'checkout_expires_at',c.expires_at) end
 order by b.created_at desc),'[]')
 from bookings b join games g on g.id=b.game_id left join venues v on v.id=g.venue_id and v.organization_id=p_org left join checkouts c on c.id=b.checkout_id
 where b.organization_id=p_org and case when b.checkout_id is null then dvc_owned(p_org,p_user,p_guest,b.id) else dvc_checkout_owned(p_org,p_user,p_guest,b.checkout_id) end;
$$;


-- The original team mover assigns every row of a booking to one court team.
-- A 6+ pricing team can include extras: fail closed until M5 supports that path.
create or replace function public.dvc_admin(p_org uuid,p_user uuid,p_action text,p_data jsonb,p_ref uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare entity uuid;
begin
 if p_action in ('booking.transfer','booking.details','receipt.approve','receipt.reject') and exists(select 1 from bookings where id=(p_data->>'id')::uuid and organization_id=p_org and (checkout_id is not null or kind='group')) then raise exception 'This checkout operation is not available yet'; end if;
 if p_action='roster.update' and exists(
  select 1 from roster_entries r join bookings b on b.id=r.booking_id
  where r.id=(p_data->>'id')::uuid and b.organization_id=p_org and b.checkout_id is not null and b.kind='team'
   and (select count(*) from roster_entries e where e.booking_id=b.id)>6
 ) then raise exception 'Lineup editing for a team with additional players is not available yet'; end if;
 entity:=dvc_legacy_admin(p_org,p_user,p_action,p_data,p_ref);
 if p_action='roster.update' then
  -- The delegate validates required profiles when naming a placeholder and
  -- clears personal fields when un-naming one. Legacy NULL flags stay NULL.
  update roster_entries set has_details=(name is not null) where id=(p_data->>'id')::uuid and has_details is not null;
 end if;
 return entity;
end $$;
revoke all on function public.dvc_admin(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.dvc_admin(uuid,uuid,text,jsonb,uuid) to service_role;

-- Preserve the private JSON assembler and owner-scoped public wrapper ACLs.
revoke all on function public.dvc_checkout_json(uuid) from public,anon,authenticated,service_role;
revoke all on function public.dvc_bookings(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.dvc_bookings(uuid,uuid,text) to service_role;
commit;
