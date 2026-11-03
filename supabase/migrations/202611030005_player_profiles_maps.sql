-- Additive: existing players remain unknown; public roster projection stays unchanged.
begin;
alter table public.roster_entries
 add column level text check (level in ('developmental','developmental_plus','intermediate','intermediate_plus','advanced')),
 add column gender text check (gender in ('male','female','prefer_not_to_say')),
 add column age integer check (age between 0 and 120),
 add column birth_date date;
alter table public.venues add column maps_url text
 check (maps_url is null or (length(maps_url)<=2048 and maps_url ~ '^https://(maps[.]app[.]goo[.]gl/[^[:space:]]*|goo[.]gl/maps/[^[:space:]]*|(www[.])?google[.]com([.]ph)?/maps([/?#][^[:space:]]*)?|maps[.]google[.]com([.]ph)?/[^[:space:]]*)$'));
create or replace function public.dvc_player_profile(p_data jsonb,p_on date,p_required boolean default true) returns jsonb
language plpgsql stable set search_path=public,pg_temp as $$
declare lev text:=nullif(p_data->>'level',''); gen text:=nullif(p_data->>'gender',''); years integer; birthday date; today date:=(now() at time zone 'Asia/Manila')::date;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Check player details'; end if;
 if lev is not null and lev not in ('developmental','developmental_plus','intermediate','intermediate_plus','advanced') then raise exception 'Choose a level'; end if;
 if gen is not null and gen not in ('male','female','prefer_not_to_say') then raise exception 'Choose a gender option'; end if;
 if p_data->>'age' is not null and p_data->>'age'<>'' then
  if jsonb_typeof(p_data->'age')<>'number' or p_data->>'age' !~ '^[0-9]+$' then raise exception 'Check age'; end if;
  years:=(p_data->>'age')::integer;
 end if;
 if nullif(p_data->>'birth_date','') is not null then
  if p_data->>'birth_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Check birthday'; end if;
  birthday:=(p_data->>'birth_date')::date;
  if birthday>today or extract(year from age(today,birthday))>120 then raise exception 'Check birthday'; end if;
  if years is not null then raise exception 'Enter age or birthday, not both'; end if;
  years:=extract(year from age(p_on,birthday));
  if birthday>p_on then raise exception 'Birthday must be on or before the game'; end if;
 end if;
 if years is not null and years not between 0 and 120 then raise exception 'Check age'; end if;
 if p_required and (lev is null or gen is null or years is null) then raise exception 'Choose level, gender, and age or birthday'; end if;
 return jsonb_build_object('level',lev,'gender',gen,'age',years,'birth_date',birthday);
end $$;
revoke all on function public.dvc_player_profile(jsonb,date,boolean) from public,anon,authenticated;
grant execute on function public.dvc_player_profile(jsonb,date,boolean) to service_role;
create or replace function public.dvc_hold(p_org uuid,p_user uuid,p_guest text,p_data jsonb,p_ref uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare g games; b bookings; p game_positions; required integer; occupied integer; team_slot integer; names jsonb; profile jsonb; player_data jsonb; teammates jsonb:=coalesce(p_data->'teammates','[]'::jsonb); pos text; n integer; kind text:=p_data->>'kind';
begin
 if p_user is null and (p_guest is null or p_guest !~ '^[a-f0-9]{64}$') then raise exception 'Sign in or continue as guest'; end if;
 select * into g from games where id=(p_data->>'game_id')::uuid and organization_id=p_org for update;
 if not found or g.status<>'published' or g.starts_at<=now() then raise exception 'This game is closed'; end if;
 if kind not in ('individual','team') or kind is null then raise exception 'Choose individual or team'; end if;
 if coalesce(p_data->>'position','') not in ('open','opposite','middle','setter') then raise exception 'Choose a position'; end if;
 if jsonb_typeof(teammates)<>'array' or jsonb_array_length(teammates)>5 then raise exception 'Add up to five teammates'; end if;
 if kind='individual' and jsonb_array_length(teammates)>0 then raise exception 'Teammates require team registration'; end if;
 if exists(select 1 from jsonb_array_elements(teammates) t where coalesce(t->>'position','') not in ('open','opposite','middle','setter') or length(trim(coalesce(t->>'name',''))) not between 1 and 100) then raise exception 'Check teammate names and positions'; end if;
 foreach pos in array array['open','opposite','middle','setter'] loop
  if (select count(*) from jsonb_array_elements(teammates) t where t->>'position'=pos) > (case when pos in ('open','middle') then 2 else 1 end)-(case when pos=p_data->>'position' then 1 else 0 end) then raise exception 'Too many teammates in that position'; end if;
 end loop;
 perform dvc_player_profile(p_data,(g.starts_at at time zone 'Asia/Manila')::date);
 perform dvc_player_profile(t,(g.starts_at at time zone 'Asia/Manila')::date) from jsonb_array_elements(teammates) t;
 if kind='team' then
  team_slot:=dvc_free_team(g.id);
  if team_slot is null then raise exception 'No whole team slot is available'; end if;
 end if;
 -- Expiry is evaluated in every availability check; no cron is required for correctness.
 update bookings set status='expired' where game_id=g.id and status='holding' and expires_at<=now();
 if (select count(*) from bookings where organization_id=p_org and ((p_user is not null and user_id=p_user) or guest_hash=p_guest) and created_at>now()-interval '1 hour')>=15 then raise exception 'Too many attempts. Try again later'; end if;
 if exists(select 1 from bookings where game_id=g.id and ((p_user is not null and user_id=p_user) or guest_hash=p_guest) and (status='reserved' or(status='holding' and expires_at>now()))) then raise exception 'You already have a booking for this game'; end if;
 foreach pos in array array['open','opposite','middle','setter'] loop
  required:=case when kind='team' then case when pos in ('open','middle') then 2 else 1 end when pos=p_data->>'position' then 1 else 0 end;
  if required>0 then
   select * into p from game_positions where game_id=g.id and position=pos;
   select count(*) into occupied from roster_entries r join bookings x on x.id=r.booking_id where x.game_id=g.id and r.position=pos and (x.status='reserved' or (x.status='holding' and x.expires_at>now()));
   if p.game_id is null or occupied+required>p.capacity then raise exception 'That position is no longer available'; end if;
  end if;
 end loop;
 if kind='individual' and not exists(select 1 from game_positions where game_id=g.id and position=p_data->>'position') then raise exception 'Choose a position'; end if;
 insert into bookings(organization_id,game_id,user_id,guest_hash,kind,captain_name,contact,amount)
 values(p_org,g.id,p_user,p_guest,kind,trim(p_data->>'name'),trim(p_data->>'contact'),case when kind='team' then g.team_price else (select price from game_positions where game_id=g.id and position=p_data->>'position') end) returning * into b;
 foreach pos in array array['open','opposite','middle','setter'] loop
  required:=case when kind='team' then case when pos in ('open','middle') then 2 else 1 end when pos=p_data->>'position' then 1 else 0 end;
  select coalesce(jsonb_agg(t),'[]') into names from jsonb_array_elements(teammates) t where t->>'position'=pos;
  for n in 1..required loop
   player_data:=case when pos=p_data->>'position' and n=1 then p_data else names->(n-1-case when pos=p_data->>'position' then 1 else 0 end) end;
   profile:=case when player_data is null then '{}'::jsonb else dvc_player_profile(player_data,(g.starts_at at time zone 'Asia/Manila')::date) end;
   insert into roster_entries(booking_id,position,name,team,is_registrant,level,gender,age,birth_date)
    values(b.id,pos,nullif(trim(player_data->>'name'),''),team_slot,pos=p_data->>'position' and n=1,profile->>'level',profile->>'gender',(profile->>'age')::int,(profile->>'birth_date')::date);
  end loop;
 end loop;
 perform dvc_event(p_org,p_user,'booking.hold',b.id,p_ref);
 return to_jsonb(b)-'guest_hash'-'contact';
end $$;

create or replace function public.dvc_admin(p_org uuid,p_user uuid,p_action text,p_data jsonb,p_ref uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare role text:=dvc_role(p_org,p_user); entity uuid; g games; b bookings; r roster_entries; p jsonb; occupied integer; pos text; required integer; target games; capacity integer; team_slot integer; v venues; target_user uuid;
begin
 if role not in ('developer','admin','coordinator','facilitator') or (role='coordinator' and p_action not in ('roster.update','faci.self','faci.assign','manual.register','booking.details')) or (role='facilitator' and p_action<>'faci.self') then raise exception 'Access denied'; end if;
 if p_action='manual.register' then
  p:=dvc_hold(p_org,null,replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),p_data,p_ref);
  entity:=(p->>'id')::uuid;
  update bookings set status='reserved',manual=true where id=entity;
 elsif p_action='game.save' then
  entity:=coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
  select * into g from games where id=entity and organization_id=p_org for update;
  if not found and p_data->>'id' is not null then raise exception 'Game not found'; end if;
  if exists(select 1 from games where id=entity and organization_id<>p_org) then raise exception 'Game not found'; end if;
  if p_data->>'status' not in ('draft','published','completed') then raise exception 'Use cancel to cancel a game'; end if;
  if g.status='cancelled' then raise exception 'Create a new game instead of reopening a cancelled game'; end if;
  if p_data->>'status'='draft' and exists(select 1 from bookings where game_id=entity and status in ('reserved','holding')) then raise exception 'A game with bookings cannot return to draft'; end if;
  select * into v from venues where id=(p_data->>'venue_id')::uuid and organization_id=p_org and (enabled or id=g.venue_id);
  if not found then raise exception 'Choose an available venue'; end if;
  p_data:=p_data||jsonb_build_object('venue',v.name,'city',v.city);
  if g.id is not null and (g.starts_at<>(p_data->>'starts_at')::timestamptz or g.ends_at<>(p_data->>'ends_at')::timestamptz or g.venue<>p_data->>'venue')
   and exists(select 1 from bookings where game_id=g.id and status='reserved') and coalesce((p_data->>'confirm_change')::boolean,false)=false then raise exception 'Confirm this schedule change for existing players'; end if;
  if (p_data->>'team_count')::int not between 1 and 20 then raise exception 'Choose one to twenty teams'; end if;
  if exists(select 1 from roster_entries re join bookings bo on bo.id=re.booking_id where bo.game_id=entity and re.team>(p_data->>'team_count')::int and (bo.status='reserved' or(bo.status='holding' and bo.expires_at>now()))) then raise exception 'Move existing players before reducing teams'; end if;
  insert into games(id,organization_id,venue,city,starts_at,ends_at,status,team_price) values(entity,p_org,trim(p_data->>'venue'),trim(p_data->>'city'),(p_data->>'starts_at')::timestamptz,(p_data->>'ends_at')::timestamptz,p_data->>'status',(p_data->>'team_price')::int)
  on conflict(id) do update set venue=excluded.venue,city=excluded.city,starts_at=excluded.starts_at,ends_at=excluded.ends_at,status=excluded.status,team_price=excluded.team_price;
  update games set venue_id=v.id,team_count=(p_data->>'team_count')::int where id=entity;
  if exists(select 1 from roster_entries re join bookings bo on bo.id=re.booking_id where bo.game_id=entity and re.birth_date>((p_data->>'starts_at')::timestamptz at time zone 'Asia/Manila')::date) then raise exception 'Game date is before a player birthday'; end if;
  update roster_entries re set age=extract(year from age(((p_data->>'starts_at')::timestamptz at time zone 'Asia/Manila')::date,re.birth_date)),version=version+1 from bookings bo where bo.id=re.booking_id and bo.game_id=entity and re.birth_date is not null;

  foreach pos in array array['open','opposite','middle','setter'] loop
   p:=p_data->'positions'->pos;
   if (p->>'capacity')::int > (p_data->>'team_count')::int * (case when pos in ('open','middle') then 2 else 1 end) then raise exception 'Capacity exceeds lineup team slots'; end if;
   if p is null then raise exception 'All four positions are required'; end if;
   select count(*) into occupied from roster_entries re join bookings bo on bo.id=re.booking_id where bo.game_id=entity and re.position=pos and (bo.status='reserved' or (bo.status='holding' and bo.expires_at>now()));
   if (p->>'capacity')::int<occupied then raise exception 'Capacity cannot be below current bookings'; end if;
   insert into game_positions(game_id,position,capacity,price) values(entity,pos,(p->>'capacity')::int,(p->>'price')::int)
   on conflict(game_id,position) do update set capacity=excluded.capacity,price=excluded.price;
  end loop;
 elsif p_action='game.cancel' then
  entity:=(p_data->>'id')::uuid;
  perform 1 from games where id=entity and organization_id=p_org for update;
  if not found then raise exception 'Game not found'; end if;
  update games set status='cancelled' where id=entity;
  update bookings set status='cancelled' where game_id=entity and status in ('holding','reserved');
 elsif p_action='roster.update' then
  entity:=(p_data->>'id')::uuid;
  select re.* into r from roster_entries re join bookings bo on bo.id=re.booking_id where re.id=entity and bo.organization_id=p_org and bo.status='reserved';
  if not found then raise exception 'Player not found'; end if;
  select * into b from bookings where id=r.booking_id;
  perform 1 from games where id=b.game_id for update;
  if not exists(select 1 from bookings where id=b.id and game_id=b.game_id and status='reserved') then raise exception 'Roster changed. Refresh and try again'; end if;
  select * into r from roster_entries where id=entity for update;
  if coalesce(r.version<>(p_data->>'expected_version')::int,true) then raise exception 'Lineup changed. Refresh and try again'; end if;
  if r.is_registrant and length(trim(coalesce(p_data->>'name','')))=0 then raise exception 'Registrant name is required'; end if;
  if p_data ? 'expected_team' and r.team is distinct from nullif(p_data->>'expected_team','')::int then raise exception 'Lineup changed. Refresh and try again'; end if;
  team_slot:=nullif(p_data->>'team','')::int;
  if team_slot is not null and (team_slot<1 or team_slot>(select team_count from games where id=b.game_id)) then raise exception 'Choose an existing team'; end if;
  if b.kind='team' then
   if team_slot is null then raise exception 'A team registration must occupy a whole team'; end if;
   if exists(select 1 from roster_entries re join bookings bo on bo.id=re.booking_id where bo.game_id=b.game_id and re.team=team_slot and bo.id<>b.id and (bo.status='reserved' or(bo.status='holding' and bo.expires_at>now()))) then raise exception 'Choose an empty team for this registration'; end if;
   update roster_entries set team=team_slot,version=version+1 where booking_id=b.id;
  elsif team_slot is not null then
   required:=case when r.position in ('open','middle') then 2 else 1 end;
   select count(*) into occupied from roster_entries re join bookings bo on bo.id=re.booking_id where bo.game_id=b.game_id and re.position=r.position and re.team=team_slot and re.id<>r.id and (bo.status='reserved' or(bo.status='holding' and bo.expires_at>now()));
   if occupied>=required then raise exception 'That team position is full'; end if;
  end if;
  update roster_entries set name=nullif(trim(p_data->>'name'),''),team=team_slot,version=version+case when b.kind='team' then 0 else 1 end where id=entity;
  if nullif(trim(p_data->>'name'),'') is null then
   update roster_entries set level=null,gender=null,age=null,birth_date=null where id=entity;
  elsif p_data ? 'profile' then
   p:=dvc_player_profile(case when nullif(trim(p_data->>'name'),'') is null then '{}'::jsonb else p_data->'profile' end,(select (starts_at at time zone 'Asia/Manila')::date from games where id=b.game_id),r.name is null and nullif(trim(p_data->>'name'),'') is not null);
   update roster_entries set level=p->>'level',gender=p->>'gender',age=(p->>'age')::int,birth_date=(p->>'birth_date')::date where id=entity;
  elsif r.name is null then raise exception 'Add player details when naming a placeholder';
  end if;
  if r.is_registrant then update bookings set captain_name=trim(p_data->>'name') where id=b.id; end if;
 elsif p_action in ('booking.cancel','receipt.approve','receipt.reject','booking.transfer') then
  entity:=(p_data->>'id')::uuid;
  select * into b from bookings where id=entity and organization_id=p_org;
  if not found then raise exception 'Booking not found'; end if;
  -- Stable ordering prevents reciprocal transfer deadlocks.
  perform 1 from games where id in (b.game_id,nullif(p_data->>'game_id','')::uuid) order by id for update;
  if not exists(select 1 from bookings where id=entity and game_id=b.game_id) then raise exception 'Booking moved. Refresh and try again'; end if;
  select * into b from bookings where id=entity for update;
  if b.status not in ('reserved','holding') then raise exception 'Booking is no longer active'; end if;
  if p_action='booking.cancel' then update bookings set status='cancelled' where id=entity;
  elsif p_action in ('receipt.approve','receipt.reject') then
   if b.status<>'reserved' or not exists(select 1 from receipts where booking_id=b.id) then raise exception 'No receipt to review'; end if;
   if b.payment_status<>'pending' then raise exception 'Receipt was already reviewed'; end if;
   if p_action='receipt.reject' and length(trim(coalesce(p_data->>'note','')))<3 then raise exception 'Give a rejection reason'; end if;
   update bookings set payment_status=case when p_action='receipt.approve' then 'approved' else 'rejected' end,status=case when p_action='receipt.reject' then 'rejected' else status end where id=entity;
   update receipts set reviewed_at=now(),reviewed_by=p_user,review_note=left(p_data->>'note',300) where booking_id=entity;
  else
   if b.status<>'reserved' then raise exception 'Only reserved bookings can transfer'; end if;
   select * into target from games where id=(p_data->>'game_id')::uuid and organization_id=p_org and status='published' and starts_at>now();
   if not found or target.id=b.game_id then raise exception 'Choose another open game'; end if;
   if b.amount<>(case when b.kind='team' then target.team_price else (select price from game_positions where game_id=target.id and position=(select position from roster_entries where booking_id=b.id limit 1)) end) then raise exception 'Transfer requires the same price'; end if;
   foreach pos in array array['open','opposite','middle','setter'] loop
    select count(*) into required from roster_entries where booking_id=b.id and position=pos;
    select count(*) into occupied from roster_entries re join bookings bo on bo.id=re.booking_id where bo.game_id=target.id and re.position=pos and (bo.status='reserved' or(bo.status='holding' and bo.expires_at>now()));
    select gp.capacity into capacity from game_positions gp where gp.game_id=target.id and gp.position=pos;
    if capacity is null or occupied+required>capacity then raise exception 'Target game has insufficient positions'; end if;
   end loop;
   team_slot:=null;
   if b.kind='team' then team_slot:=dvc_free_team(target.id); if team_slot is null then raise exception 'Target game has no whole team slot'; end if; end if;
   update bookings set game_id=target.id where id=entity;
   if exists(select 1 from roster_entries where booking_id=entity and birth_date>(target.starts_at at time zone 'Asia/Manila')::date) then raise exception 'Game date is before a player birthday'; end if;
   update roster_entries set team=team_slot,age=case when birth_date is null then age else extract(year from age((target.starts_at at time zone 'Asia/Manila')::date,birth_date))::int end,version=version+1 where booking_id=entity;
  end if;
 elsif p_action='access.save' then
  perform 1 from organizations where id=p_org for update;
  role:=dvc_role(p_org,p_user);
  if role not in ('developer','admin') then raise exception 'Access denied'; end if;
  if role<>'developer' and (p_data->>'role'='developer' or exists(select 1 from staff_email_whitelist w where w.id=nullif(p_data->>'id','')::uuid and w.role='developer')) then raise exception 'Only a developer can manage developer access'; end if;
  entity:=coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
  -- Target/actor roles were re-read under the organization lock above.
  if exists(select 1 from staff_email_whitelist where id=entity and organization_id<>p_org) then raise exception 'Entry not found'; end if;
  insert into staff_email_whitelist(id,organization_id,email,role,enabled) values(entity,p_org,lower(trim(p_data->>'email')),p_data->>'role',(p_data->>'enabled')::boolean)
  on conflict(id) do update set email=excluded.email,role=excluded.role,enabled=excluded.enabled;
  if not exists(select 1 from auth.users au where dvc_role(p_org,au.id) in ('developer','admin')) then raise exception 'Keep at least one enabled, verified admin'; end if;
 elsif p_action='payment.save' then
  entity:=coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
  if exists(select 1 from payment_methods where id=entity and organization_id<>p_org) then raise exception 'Method not found'; end if;
  if nullif(p_data->>'qr_path','') is not null and p_data->>'qr_path' !~ ('^payments/'||p_org::text||'/[a-f0-9-]{36}\.(png|jpg|webp)$') then raise exception 'Invalid QR image'; end if;
  insert into payment_methods(id,organization_id,label,account_name,account_number,qr_path,enabled)
  values(entity,p_org,trim(p_data->>'label'),trim(p_data->>'account_name'),trim(p_data->>'account_number'),nullif(p_data->>'qr_path',''),(p_data->>'enabled')::boolean)
  on conflict(id) do update set label=excluded.label,account_name=excluded.account_name,account_number=excluded.account_number,qr_path=excluded.qr_path,enabled=excluded.enabled;
 elsif p_action='booking.details' then
  entity:=(p_data->>'id')::uuid;
  select * into b from bookings where id=entity and organization_id=p_org;
  if not found then raise exception 'Registration not found'; end if;
  perform 1 from games where id=b.game_id for update;
  if not exists(select 1 from bookings where id=entity and game_id=b.game_id) then raise exception 'Registration moved. Refresh and try again'; end if;
  update bookings set captain_name=trim(p_data->>'name'),contact=trim(p_data->>'contact') where id=entity;
  update roster_entries set name=trim(p_data->>'name'),version=version+1 where booking_id=entity and is_registrant;
 elsif p_action='venue.save' then
  entity:=coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
  if p_data ? 'id' and not exists(select 1 from venues where id=entity and organization_id=p_org) then raise exception 'Venue not found'; end if;
  insert into venues(id,organization_id,name,city,enabled,maps_url) values(entity,p_org,trim(p_data->>'name'),trim(p_data->>'city'),(p_data->>'enabled')::boolean,nullif(p_data->>'maps_url',''))
  on conflict(id) do update set name=excluded.name,city=excluded.city,enabled=excluded.enabled,maps_url=case when p_data ? 'maps_url' then excluded.maps_url else venues.maps_url end;
 elsif p_action='venue.delete' then
  entity:=(p_data->>'id')::uuid;
  perform 1 from venues where id=entity and organization_id=p_org for update;
  if not found then raise exception 'Venue not found'; end if;
  if exists(select 1 from games where venue_id=entity) then update venues set enabled=false where id=entity; else delete from venues where id=entity; end if;
 elsif p_action in ('faci.self','faci.assign') then
  entity:=(p_data->>'game_id')::uuid;
  perform 1 from games where id=entity and organization_id=p_org and status='published' and ends_at>now() for update;
  if not found then raise exception 'Choose an upcoming published game'; end if;
  target_user:=case when p_action='faci.self' then p_user else (p_data->>'user_id')::uuid end;
  if p_action='faci.self' and p_data ? 'user_id' then raise exception 'Self-assignment cannot choose another person'; end if;
  if (p_data->>'enabled')::boolean and dvc_role(p_org,target_user) not in ('developer','admin','coordinator','facilitator') then raise exception 'Choose a registered staff member'; end if;
  if (p_data->>'enabled')::boolean then insert into game_facilitators(game_id,user_id) values(entity,target_user) on conflict do nothing;
  else delete from game_facilitators where game_id=entity and user_id=target_user; end if;
 else raise exception 'Unknown action'; end if;
 perform dvc_event(p_org,p_user,p_action,entity,p_ref);
 update developer_events set details=jsonb_build_object('fields',(select jsonb_agg(k) from jsonb_object_keys(p_data) k where k not in ('contact','name','email','account_name','account_number','note'))) where reference_id=p_ref and kind='activity' and actor_id=p_user;
 return entity;
end $$;

create or replace function public.dvc_schedule(p_org uuid,p_from timestamptz,p_to timestamptz) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'venue',g.venue,'city',g.city,'maps_url',(select v.maps_url from venues v where v.id=g.venue_id and v.organization_id=p_org),'starts_at',g.starts_at,'ends_at',g.ends_at,'status',g.status,'team_price',g.team_price,'team_count',g.team_count,'available_teams',(select count(*) from generate_series(1,g.team_count) n where not exists(select 1 from roster_entries re join bookings bo on bo.id=re.booking_id where bo.game_id=g.id and re.team=n and (bo.status='reserved' or(bo.status='holding' and bo.expires_at>now())))),'facilitators',(select coalesce(jsonb_agg(jsonb_build_object('name',split_part(x->>'name',' ',1))),'[]') from jsonb_array_elements(dvc_facis(g.id)) x),
  'positions',(select jsonb_agg(jsonb_build_object('position',p.position,'capacity',p.capacity,'price',p.price,'available',greatest(0,p.capacity-(select count(*) from roster_entries r join bookings b on b.id=r.booking_id where b.game_id=g.id and r.position=p.position and (b.status='reserved' or (b.status='holding' and b.expires_at>now()))))) order by p.position) from game_positions p where p.game_id=g.id)) order by g.starts_at),'[]')
 from games g where g.organization_id=p_org and g.status<>'draft' and g.starts_at>=p_from and g.starts_at<p_to;
$$;

create or replace function public.dvc_workspace(p_org uuid,p_user uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare role text:=dvc_role(p_org,p_user); result jsonb; begin
 if role not in ('developer','admin','coordinator','facilitator') then raise exception 'Staff access required'; end if;
 select jsonb_build_object('role',role,
 'games',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object('maps_url',(select v.maps_url from venues v where v.id=g.venue_id and v.organization_id=p_org),'facilitators',dvc_facis(g.id),'held_teams',coalesce((select jsonb_agg(distinct re.team) from roster_entries re join bookings bo on bo.id=re.booking_id where bo.game_id=g.id and bo.kind='team' and bo.status='holding' and bo.expires_at>now()),'[]'),'positions',(select jsonb_agg(to_jsonb(p)) from game_positions p where p.game_id=g.id)) order by g.starts_at desc) from games g where g.organization_id=p_org),'[]'),
 'roster',case when role='facilitator' then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('game_id',b.game_id,'booking_id',b.id,'kind',b.kind)) from roster_entries r join bookings b on b.id=r.booking_id where b.organization_id=p_org and b.status='reserved'),'[]') end) into result;
 if role in ('developer','admin','coordinator') then
  result:=result||jsonb_build_object('support',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'game_id',b.game_id,'captain_name',b.captain_name,'contact',b.contact,'kind',b.kind,'status',b.status) order by b.created_at desc) from bookings b where b.organization_id=p_org),'[]'),'staff',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email),'email',u.email,'role',dvc_role(p_org,u.id))) from auth.users u where dvc_role(p_org,u.id) in ('developer','admin','coordinator','facilitator')),'[]'));
 end if;
 if role in ('developer','admin') then
  result:=result||jsonb_build_object('venues',coalesce((select jsonb_agg(to_jsonb(v) order by v.name) from venues v where v.organization_id=p_org),'[]'),
   'access',coalesce((select jsonb_agg(to_jsonb(w)||jsonb_build_object('registered',exists(select 1 from auth.users au where lower(au.email)=w.email and au.email_confirmed_at is not null))) from staff_email_whitelist w where w.organization_id=p_org),'[]'),
   'payments',coalesce((select jsonb_agg(to_jsonb(m)) from payment_methods m where organization_id=p_org),'[]'),
   'bookings',coalesce((select jsonb_agg((to_jsonb(b)-'guest_hash')||jsonb_build_object('receipt',(select to_jsonb(r) from receipts r where r.booking_id=b.id)) order by b.created_at desc) from bookings b where b.organization_id=p_org),'[]'));
 end if;
 return result;
end $$;

create or replace function public.dvc_bookings(p_org uuid,p_user uuid,p_guest text) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg((to_jsonb(b)-'guest_hash'-'contact'-'user_id')||jsonb_build_object('venue',g.venue,'maps_url',(select v.maps_url from venues v where v.id=g.venue_id and v.organization_id=p_org),'starts_at',g.starts_at,'ends_at',g.ends_at,'review_note',(select review_note from receipts where booking_id=b.id),'entries',(select jsonb_agg(to_jsonb(r)) from roster_entries r where r.booking_id=b.id)) order by b.created_at desc),'[]')
 from bookings b join games g on g.id=b.game_id where b.organization_id=p_org and dvc_owned(p_org,p_user,p_guest,b.id);
$$;
commit;
