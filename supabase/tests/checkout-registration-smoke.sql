-- Developer SQL contracts on a NEW, owned database only. All synthetic data
-- rolls back. No provider identity is fabricated; this is not Auth API evidence.
begin;
do $test$
declare
 org uuid:=gen_random_uuid(); venue uuid:=gen_random_uuid(); game uuid:=gen_random_uuid(); other_game uuid:=gen_random_uuid();
 owner uuid:=gen_random_uuid(); organizer_only uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid(); booking uuid;
 organizer jsonb; payload jsonb; game_input jsonb; result jsonb; profile jsonb; slots jsonb; denied boolean; n integer;
begin
 insert into organizations(id,name) values(org,'M3 isolated SQL contract');
 insert into venues(id,organization_id,name,city) values(venue,org,'Synthetic SQL Court','TEST');
 insert into games(id,organization_id,venue,city,venue_id,starts_at,ends_at,status,team_count,team_price,team_discount_price)
 values(game,org,'Synthetic SQL Court','TEST',venue,now()+interval '10 days',now()+interval '10 days 2 hours','published',6,165000,150000),
 (other_game,org,'Other synthetic court','TEST',venue,now()+interval '11 days',now()+interval '11 days 2 hours','published',6,165000,null);
 insert into game_positions(game_id,position,capacity,price,discount_price)
 select g,p,case when p in ('open','middle') then 12 else 6 end,case when p='setter' then 25000 else 30000 end,
 case when g=game and p='setter' then 20000 when g=game and p='open' then 27500 else null end
 from unnest(array[game,other_game]) g cross join unnest(array['open','opposite','middle','setter']) p;
 organizer:=jsonb_build_object('name','Synthetic Organizer','contact','09123456789','email','organizer@example.test');
 game_input:=jsonb_build_object('game_id',game,'kind','group','organizer_plays',false,'players',jsonb_build_array(
 jsonb_build_object('position','setter','name',null,'is_registrant',false),jsonb_build_object('position','setter','name',null,'is_registrant',false)));
 payload:=jsonb_build_object('request_id',gen_random_uuid(),'organizer',organizer,'games',jsonb_build_array(game_input));
 result:=dvc_checkout_review(org,payload);
 assert (result->>'amount')::int=40000,'Repeated positions sum their effective prices';
 assert result->'games'->0->'quote'->'position_prices'->>'setter'='20000','Quote contains effective per-position consent';
 assert result->'games'->0->'quote'->>'team_price'='150000','Quote contains effective fixed-team price';
 assert (result->'games'->0->'quote'->>'starts_at')::timestamptz=(select starts_at from games where id=game),'Quote contains exact schedule consent';
 assert jsonb_array_length(result->'games'->0->'players')=2,'Non-playing organizer creates no player slot';
 assert (select count(*)=0 from bookings where organization_id=org),'Review creates no bookings';
 assert (select count(*)=0 from player_profiles where organization_id=org),'Review saves no profile';
 assert (select count(*)=0 from booking_confirmation_outbox where organization_id=org),'Review enqueues no email';
 assert (select count(*)=0 from developer_events where organization_id=org),'Review has no domain event writes';

 select jsonb_agg(jsonb_build_object('position','setter','name',null,'is_registrant',false)) into slots from generate_series(1,5);
 result:=dvc_checkout_review(org,jsonb_set(payload,'{games,0,players}',slots));
 assert result->>'amount'='100000','Five repeated positions are accepted when capacity permits';
 denied:=false; begin perform dvc_checkout_review(org,jsonb_set(payload,'{games,0,players}',slots||jsonb_build_array(slots->0))); exception when raise_exception then denied:=true; end;
 assert denied,'Six-player flexible group is rejected';
 denied:=false; begin perform dvc_checkout_review(org,jsonb_set(payload,'{games,0,players}',jsonb_build_array(slots->0))); exception when raise_exception then denied:=true; end;
 assert denied,'One-player flexible group is rejected';

 select jsonb_agg(jsonb_build_object('position',p,'name',null,'is_registrant',false)) into slots from unnest(array['open','open','opposite','middle','middle','setter']) p;
 result:=dvc_checkout_review(org,jsonb_set(jsonb_set(payload,'{games,0,kind}','"team"'),'{games,0,players}',slots));
 assert result->>'amount'='150000','Fixed team uses team price rather than the position sum';
 denied:=false; begin perform dvc_checkout_review(org,jsonb_set(jsonb_set(payload,'{games,0,kind}','"team"'),'{games,0,players}',jsonb_set(slots,'{0,position}','"setter"'))); exception when raise_exception then denied:=true; end;
 assert denied,'Fixed team retains its composition rule';

 profile:=jsonb_build_object('position','setter','name','Synthetic Player','is_registrant',false,'level','intermediate','gender','female','birth_date','1995-04-12','first_timer',false);
 result:=dvc_checkout_review(org,jsonb_set(payload,'{games}',jsonb_build_array(game_input,jsonb_build_object('game_id',other_game,'kind','individual','organizer_plays',false,'players',jsonb_build_array(profile)))));
 assert result->>'amount'='65000','Mixed multi-game review sums exact game totals';
 assert jsonb_array_length(result->'games')=2,'Each game remains a separate review selection';
 assert not (result->'games'->1->'players'->0 ? 'age'),'Computed age is not resubmitted alongside birthday';
 denied:=false; begin perform dvc_checkout_review(org,jsonb_set(payload,'{games}',jsonb_build_array(game_input,game_input))); exception when raise_exception then denied:=true; end;
 assert denied,'Duplicate game selection is rejected';
 denied:=false; begin perform dvc_checkout_review(org,jsonb_set(payload,'{organizer,email}','null')); exception when raise_exception then denied:=true; end;
 assert denied,'New checkout requires a real organizer email';
 denied:=false; begin perform dvc_checkout_review(org,jsonb_set(payload,'{games,0,players,0,name}','"Named without birthday"')); exception when raise_exception then denied:=true; end;
 assert denied,'Every named player requires complete details';
 denied:=false; begin perform dvc_checkout_review(org,jsonb_set(payload,'{games,0,organizer_plays}','true')); exception when raise_exception then denied:=true; end;
 assert denied,'Playing organizer requires an explicit player slot';
 denied:=false; begin perform dvc_checkout_review(org,jsonb_set(payload,'{games,0,players,0,first_timer}','false')); exception when raise_exception then denied:=true; end;
 assert denied,'Unnamed placeholders cannot retain someone else''s profile';
 denied:=false; begin perform dvc_checkout_review(gen_random_uuid(),payload); exception when raise_exception then denied:=true; end;
 assert denied,'Review cannot read another organization''s selected games';

 for n in 1..4 loop
  insert into bookings(organization_id,game_id,guest_hash,kind,captain_name,contact,status,amount)
  values(org,game,repeat(n::text,64),'individual','Synthetic capacity','capacity@example.test','reserved',20000) returning id into booking;
  insert into roster_entries(booking_id,position) values(booking,'setter');
 end loop;
 select jsonb_agg(jsonb_build_object('position','setter','name',null,'is_registrant',false)) into slots from generate_series(1,5);
 denied:=false; begin perform dvc_checkout_review(org,jsonb_set(payload,'{games,0,players}',slots)); exception when raise_exception then denied:=true; end;
 assert denied,'Quote rejects unavailable repeated positions';
 assert (select count(*)=4 from bookings where organization_id=org),'Failed review leaves existing reservations unchanged';

 -- No forged Google identities: plain synthetic user rows satisfy foreign keys
 -- for the service-only profile SQL projection; real Auth HTTP is tested by QA.
 insert into auth.users(id,email) values(owner,'owned-history@example.test'),(organizer_only,'organizer-only@example.test'),(stranger,'stranger@example.test');
 insert into bookings(organization_id,game_id,user_id,kind,captain_name,contact,status,amount,organizer_plays)
 values(org,other_game,owner,'individual','Legacy Player','legacy@example.test','reserved',25000,true) returning id into booking;
 insert into roster_entries(booking_id,position,name,is_registrant,age) values(booking,'open','Legacy Player',true,25);
 result:=dvc_profile(org,owner);
 assert result->>'first_timer'='false','Owned reserved registrant defaults Returnee without a saved profile';
 assert result->>'birth_date' is null,'Legacy history does not fabricate a birthday';
 assert result->>'age'='25','Legacy recorded age remains available';
 assert result->>'name'='Legacy Player','Own history supports registration autofill';
 assert dvc_profile(org,stranger) is null,'Another account cannot inherit this history';
 assert dvc_profile(gen_random_uuid(),owner) is null,'History is organization scoped';
 insert into bookings(organization_id,game_id,user_id,kind,captain_name,contact,status,amount,organizer_plays)
 values(org,other_game,organizer_only,'team','Organizer only','organizer-only@example.test','reserved',150000,false) returning id into booking;
 insert into roster_entries(booking_id,position,name,is_registrant) values(booking,'setter','Actual other player',false);
 assert dvc_profile(org,organizer_only) is null,'Organizer-only booking never marks the organizer Returnee';
 assert not has_function_privilege('anon','public.dvc_checkout_review(uuid,jsonb)','EXECUTE'),'Anon cannot call privileged review directly';
 assert not has_function_privilege('authenticated','public.dvc_checkout_review(uuid,jsonb)','EXECUTE'),'Authenticated cannot call privileged review directly';
 assert has_function_privilege('service_role','public.dvc_checkout_review(uuid,jsonb)','EXECUTE'),'Server role can call review';
 raise notice 'M3 checkout registration SQL assertions PASS';
end $test$;
set local role anon;
do $$ begin
 begin
  perform public.dvc_checkout_review('00000000-0000-0000-0000-000000000001','{}');
  raise exception 'Unexpected anonymous access';
 exception when insufficient_privilege then raise notice 'Anonymous direct RPC denied'; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
 begin
  perform public.dvc_checkout_review('00000000-0000-0000-0000-000000000001','{}');
  raise exception 'Unexpected authenticated direct access';
 exception when insufficient_privilege then raise notice 'Authenticated direct RPC denied'; end;
end $$;
reset role;
set local role service_role;
do $$ begin
 begin
  perform public.dvc_checkout_review('00000000-0000-0000-0000-000000000001','{}');
  raise exception 'Invalid draft unexpectedly accepted';
 exception when raise_exception then
  if sqlerrm<>'Check organizer name and contact' then raise; end if;
  raise notice 'Service RPC allowed and validates input';
 end;
end $$;
reset role;
rollback;
