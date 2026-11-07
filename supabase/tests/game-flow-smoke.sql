-- Isolated local PostgreSQL contract test only. Synthetic platform identities below
-- must never be inserted into a shared/project Auth database. All writes roll back.
begin;
do $test$
declare
 org uuid:='00000000-0000-0000-0000-000000000001';
 dev uuid:='11111111-1111-4111-8111-000000000001'; adm uuid:='11111111-1111-4111-8111-000000000002';
 coord uuid:='11111111-1111-4111-8111-000000000003'; faci uuid:='11111111-1111-4111-8111-000000000004';
 player uuid:='11111111-1111-4111-8111-000000000005'; organizer uuid:='11111111-1111-4111-8111-000000000006';
 unverified uuid:='11111111-1111-4111-8111-000000000007';
 venue uuid:=gen_random_uuid(); game uuid:=gen_random_uuid(); target uuid:=gen_random_uuid(); zero_game uuid;
 booking uuid; own_booking uuid; legacy_booking uuid:=gen_random_uuid(); legacy_entry uuid:=gen_random_uuid(); placeholder uuid;
 note uuid; active_note uuid; payload jsonb; prof jsonb; result jsonb; saved jsonb; ws jsonb; before_count integer;
 denied boolean; r record;
begin
 -- Minimal synthetic actors exercise actual SQL role derivation, including Google verification.
 for r in select * from (values
  (dev,'dev@example.invalid','developer'),(adm,'admin@example.invalid','admin'),(coord,'coord@example.invalid','coordinator'),
  (faci,'facilitator@example.invalid','facilitator'),(player,'player@example.invalid','player'),(organizer,'organizer@example.invalid','player'),(unverified,'unverified@example.invalid','admin')
 ) as actors(id,email,role) loop
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(r.id,r.email,case when r.id=unverified then null else now() end,jsonb_build_object('full_name','Synthetic actor'));
  insert into auth.identities(user_id,provider,provider_id,identity_data) values(r.id,'google',r.id::text,jsonb_build_object('email',r.email,'email_verified',r.id<>unverified));
  if r.role<>'player' then insert into staff_email_whitelist(organization_id,email,role) values(org,r.email,r.role); end if;
 end loop;
 assert dvc_role(org,dev)='developer','Developer role derives from enabled verified identity';
 assert dvc_role(org,unverified)='player','Unverified prepared staff remains Player';

 insert into venues(id,organization_id,name,city) values(venue,org,'Synthetic contract court','TEST');
 insert into games(id,organization_id,venue,city,venue_id,starts_at,ends_at,status,team_price,team_discount_price,team_count)
 values(game,org,'Synthetic contract court','TEST',venue,now()+interval '2 days',now()+interval '2 days 3 hours','published',120000,90000,6),
 (target,org,'Synthetic transfer court','TEST',venue,now()+interval '3 days',now()+interval '3 days 3 hours','published',120000,90000,6);
 insert into game_positions(game_id,position,capacity,price,discount_price)
 select ga,p,case when p in ('open','middle') then 12 else 6 end,20000,15000 from unnest(array[game,target]) ga cross join unnest(array['open','opposite','middle','setter']) p;
 prof:=jsonb_build_object('level','intermediate','gender','prefer_not_to_say','birth_date','2000-11-04','first_timer',false);

 -- New players require birthday and explicit first-timer choice; failures leave no partial booking.
 before_count:=(select count(*) from bookings where game_id=game);
 denied:=false;
 begin perform dvc_hold(org,null,repeat('a',64),prof-'birth_date'||jsonb_build_object('age',25,'game_id',game,'kind','individual','position','setter','name','Missing birthday','contact','test@example.invalid'),gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied,'Age-only new registration rejected';
 denied:=false;
 begin perform dvc_hold(org,null,repeat('a',64),prof-'first_timer'||jsonb_build_object('game_id',game,'kind','individual','position','setter','name','Missing first-timer','contact','test@example.invalid'),gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied,'Missing first-timer rejected';
 assert (select count(*) from bookings where game_id=game)=before_count,'Rejected details do not reserve slots';

 -- A team organizer need not play: precisely six placeholders, no organizer roster/profile entry.
 payload:=jsonb_build_object('game_id',game,'kind','team','organizer_plays',false,'name','Non-playing organizer','contact','phone-only','organizer_email',' ORGANIZER@EXAMPLE.INVALID ');
 result:=dvc_hold(org,organizer,null,payload,gen_random_uuid());booking:=(result->>'id')::uuid;
 assert (select count(*)=6 from roster_entries where booking_id=booking),'Non-playing organizer holds exactly six slots';
 assert not exists(select 1 from roster_entries where booking_id=booking and (name='Non-playing organizer' or is_registrant)),'Organizer occupies no slot';
 assert (select count(*)=2 from roster_entries where booking_id=booking and position='open'),'Two Open slots';
 assert (select count(*)=2 from roster_entries where booking_id=booking and position='middle'),'Two Middle slots';
 assert (select count(*)=1 from roster_entries where booking_id=booking and position='setter'),'One Setter slot';
 assert (select count(*)=1 from roster_entries where booking_id=booking and position='opposite'),'One Opposite slot';
 assert (select amount=90000 and organizer_email='organizer@example.invalid' and not organizer_plays from bookings where id=booking),'Team discount and organizer email persist';
 assert dvc_profile(org,organizer) is null,'A non-playing organizer never creates a player profile';
 assert (select count(distinct team)=1 from roster_entries where booking_id=booking),'Whole team holds one team';
 update games set team_discount_price=80000 where id=game;
 assert (select amount=90000 from bookings where id=booking),'Discount updates never reprice an existing hold';
 update bookings set status='reserved' where id=booking;
 perform dvc_admin(org,adm,'booking.transfer',jsonb_build_object('id',booking,'game_id',target),gen_random_uuid());
 assert (select game_id=target and amount=90000 from bookings where id=booking),'Transfer compares snapshot against destination effective total';
 assert (select count(*)=6 and count(distinct team)=1 from roster_entries where booking_id=booking),'Transfer keeps all six together';

 -- Playing registrant profile is saved privately and age uses the game date.
 payload:=prof||jsonb_build_object('game_id',game,'kind','individual','position','setter','name','Self player','contact','player@example.invalid','organizer_email','player@example.invalid','first_timer',true);
 result:=dvc_hold(org,player,null,payload,gen_random_uuid());own_booking:=(result->>'id')::uuid;
 assert (select amount=15000 from bookings where id=own_booking),'Individual price uses fixed discount';
 assert exists(select 1 from roster_entries re join bookings b on b.id=re.booking_id join games g on g.id=b.game_id where re.booking_id=own_booking and re.birth_date='2000-11-04' and re.age=extract(year from age((g.starts_at at time zone 'Asia/Manila')::date,re.birth_date))),'Age is computed on Manila game date';
 result:=dvc_profile(org,player);
 assert result->>'name'='Self player' and (result->>'first_timer')::boolean,'Own profile prefills supplied first-timer before a reserved registration';
 assert dvc_profile(org,null) is null,'Guest has no profile lookup';
 assert dvc_profile(org,organizer) is null,'Other account has no access to saved player profile through its own actor';
 update bookings set status='reserved' where id=own_booking;
 assert (dvc_profile(org,player)->>'first_timer')::boolean=false,'Own prior reserved registration defaults Returnee';
 assert jsonb_array_length(dvc_bookings(org,null,repeat('f',64)))=0,'Another guest cannot read private booking profiles';
 assert not exists(select 1 from jsonb_array_elements(dvc_roster(org,game)) x where x ?| array['email','birth_date','age','first_timer','level','gender','organizer_email']),'Public roster excludes all new private fields';
 update game_positions set discount_price=10000 where game_id=game and position='setter';
 assert (select amount=15000 from bookings where id=own_booking),'Later position discounts do not reprice reserved booking';
 denied:=false;
 begin perform dvc_admin(org,adm,'booking.transfer',jsonb_build_object('id',own_booking,'game_id',target),gen_random_uuid()); exception when raise_exception then denied:=true; end;
 -- Target individual remains 15000, matching the snapshot, so the transfer should succeed.
 assert not denied,'Matching individual effective price allows transfer';
 update game_positions set discount_price=14000 where game_id=game and position='setter';
 denied:=false;
 begin perform dvc_admin(org,adm,'booking.transfer',jsonb_build_object('id',own_booking,'game_id',game),gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied,'Different destination effective price rejects transfer';
 assert (select game_id=target and amount=15000 from bookings where id=own_booking),'Failed transfer preserves original booking';

 -- Six named teammates all require their own details; organizer is still not one of them.
 payload:=jsonb_build_object('game_id',game,'kind','team','organizer_plays',false,'name','Guest organizer','contact','guest@example.invalid','teammates',
 (select jsonb_agg(prof||jsonb_build_object('name','Player '||n,'position',p,'email','player'||n||'@example.invalid')) from unnest(array['open','open','opposite','middle','middle','setter']) with ordinality as slots(p,n)));
 result:=dvc_hold(org,null,repeat('b',64),payload,gen_random_uuid());saved:=result;
 assert (select count(*)=6 from roster_entries where booking_id=(result->>'id')::uuid and name is not null and first_timer=false and email is not null),'All six actual named player details persist privately';
 denied:=false;
 begin perform dvc_hold(org,null,repeat('c',64),jsonb_set(payload,'{teammates,0}',(payload->'teammates'->0)-'birth_date'),gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied,'Named teammate birthday required';
 denied:=false;
 begin perform dvc_hold(org,null,repeat('c',64),payload||jsonb_build_object('position','setter'),gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied,'Non-playing organizer cannot select a player position';

 -- Legacy age-only staff edits retain their supplied age; first naming a placeholder requires new details.
 insert into bookings(id,organization_id,game_id,guest_hash,kind,captain_name,contact,amount,status,manual)
 values(legacy_booking,org,game,repeat('d',64),'individual','Legacy player','legacy@example.invalid',20000,'reserved',true);
 insert into roster_entries(id,booking_id,name,position,team,is_registrant,level,gender,age,first_timer)
 values(legacy_entry,legacy_booking,'Legacy player','open',null,true,'intermediate','male',25,null);
 perform dvc_admin(org,coord,'roster.update',jsonb_build_object('id',legacy_entry,'name','Legacy renamed','team',null,'expected_version',0,'profile',jsonb_build_object('level','intermediate','gender','male','age',25)),gen_random_uuid());
 assert (select age=25 and birth_date is null and first_timer is null from roster_entries where id=legacy_entry),'Legacy profile edit preserves age and unknown history';
 select id into placeholder from roster_entries where booking_id=booking order by id limit 1;
 denied:=false;
 begin perform dvc_admin(org,coord,'roster.update',jsonb_build_object('id',placeholder,'name','Named placeholder','team',(select team from roster_entries where id=placeholder),'expected_version',(select version from roster_entries where id=placeholder),'profile',jsonb_build_object('level','intermediate','gender','female','age',25)),gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied,'Newly named placeholder cannot use age-only details';

 -- Announcement permission, published projection and unpublish behavior.
 note:=dvc_admin(org,coord,'announcement.save',jsonb_build_object('title','Draft update','body','Not published','enabled',false),gen_random_uuid());
 assert jsonb_array_length(dvc_announcements(org))=0,'Draft banner hidden publicly';
 active_note:=dvc_admin(org,coord,'announcement.save',jsonb_build_object('title','Court update','body','Plain-text announcement','enabled',true),gen_random_uuid());
 result:=dvc_announcements(org);
 assert jsonb_array_length(result)=1 and result->0->>'id'=active_note::text,'Coordinator can publish public banner';
 assert not (result->0 ? 'updated_by'),'Public banner hides author identity';
 denied:=false;
 begin perform dvc_admin(org,faci,'announcement.save',jsonb_build_object('title','Denied','body','Denied','enabled',true),gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied,'Facilitator cannot manage announcements';
 denied:=false;
 begin perform dvc_admin(org,player,'announcement.save',jsonb_build_object('title','Denied','body','Denied','enabled',true),gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied,'Player cannot manage announcements';
 perform dvc_admin(org,coord,'announcement.save',jsonb_build_object('id',active_note,'title','Court update','body','Plain-text announcement','enabled',false),gen_random_uuid());
 assert jsonb_array_length(dvc_announcements(org))=0,'Unpublished banner disappears publicly';

 -- Registered Players are included in admin directory; coordinators retain support without finance/users.
 ws:=dvc_workspace(org,adm);
 assert exists(select 1 from jsonb_array_elements(ws->'users') u where u->>'id'=player::text and u->>'role'='player'),'Admin directory includes registered default Players';
 assert exists(select 1 from jsonb_array_elements(ws->'users') u where u->>'id'=unverified::text and (u->>'verified')::boolean=false),'Unverified account status is explicit';
 ws:=dvc_workspace(org,coord);
 assert ws ? 'announcements' and not (ws ?| array['users','payments','bookings','access']),'Coordinator gets announcement/support data without users or finance';
 denied:=false;
 begin perform dvc_admin(org,coord,'access.save',jsonb_build_object('email','player@example.invalid','role','admin','enabled',true),gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied,'Coordinator cannot grant roles';
 perform dvc_admin(org,adm,'access.save',jsonb_build_object('email','player@example.invalid','role','facilitator','enabled',true),gen_random_uuid());
 assert dvc_role(org,player)='facilitator','Admin can assign omitted registered account';
 perform dvc_admin(org,adm,'access.save',jsonb_build_object('email','player@example.invalid','role','coordinator','enabled',true),gen_random_uuid());
 assert dvc_role(org,player)='coordinator','Email-based role change updates existing prepared entry';
 assert (select count(*)=1 from staff_email_whitelist where organization_id=org and email='player@example.invalid'),'Role update does not duplicate prepared email';
 denied:=false;
 begin perform dvc_admin(org,adm,'access.save',jsonb_build_object('email','dev@example.invalid','role','facilitator','enabled',true),gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied and dvc_role(org,dev)='developer','Admin cannot edit Developer via email-based upsert';

 -- Discount save path supports zero and safe regular-price reductions; public amounts are effective.
 payload:=jsonb_build_object('venue_id',venue,'team_count',2,'starts_at',now()+interval '8 days','ends_at',now()+interval '8 days 3 hours','status','published','team_price',120000,'team_discount_price',0,'positions',
 (select jsonb_object_agg(p,jsonb_build_object('capacity',case when p in ('open','middle') then 4 else 2 end,'price',20000,'discount_price',0)) from unnest(array['open','opposite','middle','setter']) p));
 zero_game:=dvc_admin(org,adm,'game.save',payload,gen_random_uuid());
 assert exists(select 1 from jsonb_array_elements(dvc_schedule(org,now(),now()+interval '14 days')) g where g->>'id'=zero_game::text and (g->>'team_price')::int=0 and (g->>'regular_team_price')::int=120000),'Public schedule separates regular/effective team prices';
 result:=(select x from jsonb_array_elements(dvc_schedule(org,now(),now()+interval '14 days')) x where x->>'id'=zero_game::text);
 assert not exists(select 1 from jsonb_array_elements(result->'positions') p where (p->>'price')::int<>0 or (p->>'regular_price')::int<>20000),'Public position prices use zero discount';
 denied:=false;
 begin perform dvc_admin(org,adm,'game.save',payload||jsonb_build_object('id',zero_game,'team_discount_price',120001),gen_random_uuid()); exception when check_violation then denied:=true; end;
 assert denied,'Discount greater than regular price rejected in DB';
 assert (select team_discount_price=0 from games where id=zero_game),'Failed discount edit rolls back prior discount clearing';
 perform dvc_admin(org,adm,'game.save',payload||jsonb_build_object('id',zero_game,'team_price',100000,'team_discount_price',null),gen_random_uuid());
 assert (select team_price=100000 and team_discount_price is null from games where id=zero_game),'Regular-price reduction clears old discount atomically';

 -- Service-only access is explicit on all new private tables/functions.
 assert not has_table_privilege('anon','player_profiles','SELECT'),'Anon cannot read saved profiles directly';
 assert not has_table_privilege('authenticated','player_profiles','SELECT'),'Authenticated role cannot enumerate profiles';
 assert not has_table_privilege('authenticated','club_announcements','UPDATE'),'Authenticated role cannot publish directly';
 assert not has_function_privilege('anon','dvc_profile(uuid,uuid)','EXECUTE'),'Anon cannot select another profile actor';
 assert not has_function_privilege('authenticated','dvc_profile(uuid,uuid)','EXECUTE'),'Authenticated role cannot spoof profile actor';
 assert not has_function_privilege('anon','dvc_announcements(uuid)','EXECUTE'),'Public server wrapper remains the only banner read path';
 assert (select relrowsecurity from pg_class where oid='public.player_profiles'::regclass),'Profile RLS enabled';
 assert (select relrowsecurity from pg_class where oid='public.club_announcements'::regclass),'Announcement RLS enabled';
end $test$;
select 'PASS: organizer allocation, birthday/first-timer, profile ownership, discount snapshots/transfers, legacy edits, announcements, directory/roles and service-only permissions' as result;
rollback;
