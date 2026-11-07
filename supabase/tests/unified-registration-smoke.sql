-- Developer SQL proof only, run on the newly created owned database. All test
-- fixtures below roll back; persistent historical fixtures were seeded before
-- this draft so upgrade preservation and old-request replay can be asserted.
begin;
do $test$
declare
 org uuid:=gen_random_uuid(); venue uuid:=gen_random_uuid(); game uuid:=gen_random_uuid(); other_game uuid:=gen_random_uuid();
 actor uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); ghash text:=repeat('a',64); wrong text:=repeat('b',64);
 organizer jsonb; payload jsonb; quoted jsonb; result jsonb; held jsonb; positions jsonb; players jsonb; player jsonb;
 profile jsonb; edit jsonb; replay jsonb; old record; target uuid; selected_booking uuid; selected_checkout uuid; other_entry uuid;
 before_rows jsonb; after_rows jsonb; before_order jsonb; after_order jsonb; expected_order jsonb; denied boolean; n integer; pos_loop text; amt integer; entry_version integer; starts timestamptz;
begin
 insert into organizations(id,name) values(org,'Unified isolated developer proof');
 insert into venues(id,organization_id,name,city) values(venue,org,'Synthetic Unified Court','TEST');
 insert into games(id,organization_id,venue,city,venue_id,starts_at,ends_at,status,team_count,team_price,team_discount_price)
 values(game,org,'Synthetic Unified Court','TEST',venue,clock_timestamp()+interval '10 days',clock_timestamp()+interval '10 days 2 hours','published',10,165000,150000),
 (other_game,org,'Other Unified Court','TEST',venue,clock_timestamp()+interval '11 days',clock_timestamp()+interval '11 days 2 hours','published',10,165000,null);
 insert into game_positions(game_id,position,capacity,price,discount_price)
 select g,p,case when p in ('open','middle') then 20 else 10 end,case when p='setter' then 25000 else 30000 end,
 case when g=game and p='setter' then 20000 when g=game and p='open' then 27500 else null end
 from unnest(array[game,other_game]) g cross join unnest(array['open','opposite','middle','setter']) p;
 insert into auth.users(id,email) values(actor,'unified-owner@example.test'),(outsider,'unified-outsider@example.test');
 insert into player_profiles(organization_id,user_id,name,contact,position,level,gender,birth_date,first_timer)
 values(org,actor,'Existing saved profile','saved@example.test','setter','advanced','female','1990-01-01',false);
 organizer:=jsonb_build_object('name','Synthetic Organizer','contact','09123456789','email','organizer@example.test');
 profile:=jsonb_build_object('name','Synthetic Player','has_details',true,'is_registrant',false,'level','intermediate','gender','female','birth_date','1995-04-12','first_timer',false,'email','player@example.test');
 player:=jsonb_build_object('position','setter','name',null,'has_details',false,'is_registrant',false);
 payload:=jsonb_build_object('request_id',gen_random_uuid(),'organizer',organizer,'games',jsonb_build_array(jsonb_build_object('game_id',game,'kind','individual','organizer_plays',false,'players',jsonb_build_array(player))));
 result:=dvc_checkout_review(org,payload);
 assert result->>'amount'='20000','Position-only individual uses the effective position price';
 assert result->'games'->0->'players'->0->>'has_details'='false','Position-only choice survives authoritative quote';
 assert result->'games'->0->'players'->0->>'name' is null,'No name fabricated for a position-only participant';
 assert not (result->'games'->0->'players'->0 ? 'birth_date'),'No birthday fabricated for a position-only participant';

 for n in 2..5 loop
  select jsonb_agg(player) into players from generate_series(1,n);
  result:=dvc_checkout_review(org,jsonb_set(jsonb_set(payload,'{games,0,kind}','"group"'),'{games,0,players}',players));
  assert (result->>'amount')::int=n*20000,'Group repeated positions sum all effective prices';
 end loop;
 for n in 6..12 loop
  select jsonb_agg(jsonb_build_object('position',pos,'name',null,'has_details',false,'is_registrant',false) order by idx) into players
  from unnest(array['open','open','opposite','middle','middle','setter']||array_fill('open'::text,array[n-6])) with ordinality x(pos,idx);
  result:=dvc_checkout_review(org,jsonb_set(jsonb_set(payload,'{games,0,kind}','"team"'),'{games,0,players}',players));
  assert result->>'amount'='150000','Six-plus players retain one flat discounted team price';
  assert jsonb_array_length(result->'games'->0->'players')=n,'Quote retains every actual team player';
 end loop;
 denied:=false; begin perform dvc_checkout_review(org,jsonb_set(jsonb_set(payload,'{games,0,kind}','"team"'),'{games,0,players}',jsonb_build_array(player,player,player,player,player,player,player))); exception when raise_exception then denied:=true; end;
 assert denied,'Extra players cannot replace a missing minimum core position';
 denied:=false; begin perform dvc_checkout_review(org,jsonb_set(payload,'{games,0,players,0,has_details}','true')); exception when raise_exception then denied:=true; end;
 assert denied,'Opted-in details require complete name and profile';
 denied:=false; begin perform dvc_checkout_review(org,jsonb_set(payload,'{games,0,players,0,name}','"PII while unchecked"')); exception when raise_exception then denied:=true; end;
 assert denied,'Unchecked details reject retained personal fields';
 denied:=false; begin perform dvc_checkout_review(org,payload#-'{games,0,players,0,has_details}'); exception when raise_exception then denied:=true; end;
 assert denied,'New SQL reviews require an explicit optional-details choice';
 result:=dvc_checkout_review(org,jsonb_set(payload,'{games,0,players}',jsonb_build_array(profile||jsonb_build_object('position','setter'))));
 assert result->'games'->0->'players'->0->>'birth_date'='1995-04-12','Opted-in details are preserved';
 assert not (result->'games'->0->'players'->0 ? 'age'),'Quote does not resubmit age alongside birthday';

 -- Atomic multi-game hold, including a seventh player at one team price.
 players:='[]';
 foreach pos_loop in array array['open','open','opposite','middle','middle','setter','open'] loop
  players:=players||jsonb_build_array(jsonb_build_object('position',pos_loop,'name',null,'has_details',false,'is_registrant',false));
 end loop;
 payload:=jsonb_set(jsonb_set(payload,'{games,0,kind}','"team"'),'{games,0,players}',players);
 payload:=jsonb_set(payload,'{games}',payload->'games'||jsonb_build_array(jsonb_build_object('game_id',other_game,'kind','individual','organizer_plays',true,'players',jsonb_build_array(jsonb_build_object('position','setter','name',null,'has_details',false,'is_registrant',true)))));
 quoted:=dvc_checkout_review(org,payload);
 select jsonb_agg(x.value||jsonb_build_object('expected_amount',q.value->'amount','expected_quote',q.value->'quote') order by x.ordinality) into players
 from jsonb_array_elements(payload->'games') with ordinality x(value,ordinality) join jsonb_array_elements(quoted->'games') with ordinality q(value,ordinality) using(ordinality);
 payload:=jsonb_set(payload,'{games}',players);
 held:=dvc_checkout_hold(org,actor,null,payload,gen_random_uuid());
 assert held->>'outcome'='created','Two-game checkout is created atomically';
 selected_checkout:=(held->'checkout'->>'id')::uuid;
 assert held->'checkout'->>'amount'='175000','One team price plus one individual game price';
 assert (select count(*)=8 from roster_entries r join bookings b on b.id=r.booking_id where b.checkout_id=selected_checkout),'Every actual player consumes a roster slot';
 -- Qualify the ambiguous PL/pgSQL IDs in subsequent queries explicitly.
 select b.id into selected_booking from bookings b where b.checkout_id=(held->'checkout'->>'id')::uuid and b.game_id=game;
 assert (select count(*)=6 from roster_entries r where r.booking_id=selected_booking and r.team is not null),'Only core six occupy the six-slot lineup';
 assert (select count(*)=1 from roster_entries r where r.booking_id=selected_booking and r.team is null and r.position='open'),'Additional player stays unassigned without losing its reservation';
 assert (select bool_and(not r.has_details and r.name is null and r.birth_date is null and r.email is null) from roster_entries r join bookings b on b.id=r.booking_id where b.checkout_id=(held->'checkout'->>'id')::uuid),'Unchecked details persist no personal data, including organizer-only choice';
 assert (select name='Existing saved profile' and level='advanced' from player_profiles where organization_id=org and user_id=actor),'Position-only organizer does not overwrite a saved profile';
 assert (select count(distinct b.expires_at)=1 from bookings b where b.checkout_id=(held->'checkout'->>'id')::uuid),'All children retain one original expiry';
 replay:=dvc_checkout_hold(org,actor,null,payload,gen_random_uuid());
 assert replay->>'outcome'='existing' and replay->'checkout'->>'id'=held->'checkout'->>'id','Duplicate submission reuses the original checkout';
 assert (dvc_checkout_json(selected_checkout)->'bookings'->0 ? 'game_status'),'Owned checkout exposes the real game status for edit gating';
 assert (dvc_bookings(org,actor,null)->0 ? 'game_status'),'Owned bookings expose the real game status';

 -- A conflict in an added player's real position creates no checkout at all.
 update game_positions set capacity=3 where game_id=game and position='open';
 payload:=jsonb_set(payload,'{request_id}',to_jsonb(gen_random_uuid()));
 result:=dvc_checkout_hold(org,actor,null,payload,gen_random_uuid());
 assert result->>'outcome'='selection_conflict','Extra-player position capacity is enforced under the original atomic hold';
 assert (select count(*)=1 from checkouts where organization_id=org),'Capacity conflict creates no partial checkout';
 update game_positions set capacity=20 where game_id=game and position='open';

 -- Owner editing: immutable booking facts and all untargeted entries survive.
 select r.id,r.version into target,entry_version from roster_entries r where r.booking_id=selected_booking and r.team is null;
 select r.id into other_entry from roster_entries r where r.booking_id=selected_booking and r.id<>target limit 1;
 select jsonb_agg(to_jsonb(r) order by r.id) into before_rows from roster_entries r where r.booking_id=selected_booking and r.id<>target;
 -- Participant ordinals are derived from the owned response. Saving an entry
 -- must not move it or any other entry when PostgreSQL creates a new heap tuple.
 select jsonb_agg(e.value->'id' order by e.ordinality) into before_order
 from jsonb_array_elements(dvc_bookings(org,actor,null)) b(value)
 cross join lateral jsonb_array_elements(b.value->'entries') with ordinality e(value,ordinality)
 where b.value->>'id'=selected_booking::text;
 select jsonb_agg(r.id order by r.id) into expected_order from roster_entries r where r.booking_id=selected_booking;
 assert before_order=expected_order,'Owned booking participants have deterministic ID ordering before saving';
 edit:=jsonb_build_object('booking_id',selected_booking,'entry_id',target,'expected_version',entry_version,'has_details',true)||(profile-'is_registrant');
 result:=dvc_booking_player_update(org,actor,null,edit,gen_random_uuid());
 assert result->>'has_details'='true' and result->>'name'='Synthetic Player','Owner can add complete personal details';
 assert (result->>'version')::int=entry_version+1,'Owner edits advance optimistic entry_version';
 assert result->>'id'=target::text,'Saving details keeps the exact target entry ID';
 select jsonb_agg(e.value->'id' order by e.ordinality) into after_order
 from jsonb_array_elements(dvc_bookings(org,actor,null)) b(value)
 cross join lateral jsonb_array_elements(b.value->'entries') with ordinality e(value,ordinality)
 where b.value->>'id'=selected_booking::text;
 assert after_order=before_order,'Save then read preserves every participant ordinal and entry ID';
 assert after_order=expected_order,'Updated tuple remains ordered by immutable entry ID';

 assert result->>'position'='open' and result->>'team' is null,'Owner edits preserve position and extra lineup status';
 select jsonb_agg(to_jsonb(r) order by r.id) into after_rows from roster_entries r where r.booking_id=selected_booking and r.id<>target;
 assert before_rows=after_rows,'Owner edit leaves all other participants unchanged';
 assert (select amount=150000 and kind='team' and b.checkout_id is not null from bookings b where b.id=selected_booking),'Owner edit preserves accepted booking price and kind';
 denied:=false; begin perform dvc_booking_player_update(org,actor,null,edit,gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied,'Stale entry_version cannot overwrite a later owner or staff edit';
 edit:=jsonb_set(edit,'{expected_version}',to_jsonb(entry_version+1));
 select r.id into other_entry from roster_entries r join bookings b on b.id=r.booking_id where b.checkout_id=selected_checkout and b.id<>selected_booking limit 1;
 denied:=false; begin perform dvc_booking_player_update(org,actor,null,jsonb_set(edit,'{entry_id}',to_jsonb(other_entry)),gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied,'An entry from another owned booking cannot be edited through the selected booking';
 denied:=false; begin perform dvc_booking_player_update(org,outsider,null,edit,gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied,'Another account cannot edit the participant';
 denied:=false; begin perform dvc_booking_player_update(gen_random_uuid(),actor,null,edit,gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied,'Another organization cannot edit the participant';
 denied:=false; begin perform dvc_booking_player_update(org,null,wrong,edit,gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied,'A guest credential cannot access an account booking';
 denied:=false; begin perform dvc_booking_player_update(org,actor,null,edit||jsonb_build_object('position','setter'),gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied,'Even service RPC rejects position changes on personal editing';
 edit:=jsonb_build_object('booking_id',selected_booking,'entry_id',target,'expected_version',entry_version+1,'has_details',false,'name',null);
 result:=dvc_booking_player_update(org,actor,null,edit,gen_random_uuid());
 assert result->>'has_details'='false' and result->>'birth_date' is null and result->>'name' is null and result->>'email' is null,'Explicit opt-out clears only target personal fields';
 entry_version:=(result->>'version')::int;
 edit:=jsonb_set(edit,'{expected_version}',to_jsonb(entry_version));
 update games set starts_at=clock_timestamp()+interval '1 hour 60 seconds' where id=game;
 result:=dvc_booking_player_update(org,actor,null,edit,gen_random_uuid());
 assert result->>'id'=target::text,'Editing is allowed strictly before the cutoff';
 edit:=jsonb_set(edit,'{expected_version}',to_jsonb((result->>'version')::int));
 update games set starts_at=clock_timestamp()+interval '1 hour' where id=game;
 denied:=false; begin perform dvc_booking_player_update(org,actor,null,edit,gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied,'At the one-hour cutoff the server denies editing';
 update games set starts_at=clock_timestamp()+interval '59 minutes' where id=game;
 denied:=false; begin perform dvc_booking_player_update(org,actor,null,edit,gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied,'After the cutoff the server denies editing';
 update games set starts_at=clock_timestamp()+interval '10 days',status='cancelled' where id=game;
 denied:=false; begin perform dvc_booking_player_update(org,actor,null,edit,gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied,'Cancelled game is not editable';
 update games set status='published' where id=game;
 update bookings set expires_at=clock_timestamp()-interval '1 second' where id=selected_booking;
 denied:=false; begin perform dvc_booking_player_update(org,actor,null,edit,gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied,'Expired holding booking is not editable';
 update bookings set status='reserved',payment_status='approved' where id=selected_booking;
 result:=dvc_booking_player_update(org,actor,null,edit,gen_random_uuid());
 assert result->>'id'=target::text,'Reserved booking remains editable before the cutoff';
 edit:=jsonb_set(edit,'{expected_version}',to_jsonb((result->>'version')::int));
 update bookings set status='cancelled' where id=selected_booking;
 denied:=false; begin perform dvc_booking_player_update(org,actor,null,edit,gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied,'Cancelled booking cannot be edited even when game stays published';
 update bookings set status='reserved' where id=selected_booking;


 -- Pre-upgrade legacy rows and accepted requests have not been backfilled.
 for old in select * from public.unified_proof_legacy loop
  assert (select to_jsonb(b) from bookings b where b.id=old.legacy_booking)=old.legacy_snapshot,'Historical age-only booking status/price survives upgrade';
  assert (select birth_date is null and age=25 and has_details is null from roster_entries where id=old.legacy_entry),'Legacy age remains without fabricated birthday/details choice';
  result:=dvc_checkout_hold(old.organization_id,null,old.guest_hash,old.payload,gen_random_uuid());
  assert result->>'outcome'='existing' and result->'checkout'->>'id'=old.checkout_id::text,'Accepted old payload replays before strict new-details validation';
  assert (select request_fingerprint=old.fingerprint from checkouts where id=old.checkout_id),'Old accepted request fingerprint is unchanged';
  select b.id,r.id,r.version into selected_booking,target,entry_version from bookings b join roster_entries r on r.booking_id=b.id where b.checkout_id=old.checkout_id order by r.id limit 1;
  edit:=jsonb_build_object('booking_id',selected_booking,'entry_id',target,'expected_version',entry_version,'has_details',false,'name',null);
  result:=dvc_booking_player_update(old.organization_id,null,old.guest_hash,edit,gen_random_uuid());
  assert result->>'id'=target::text and result->>'has_details'='false','Matching guest owner can edit an old accepted group participant';
  edit:=jsonb_set(edit,'{expected_version}',to_jsonb((result->>'version')::int));
  denied:=false; begin perform dvc_booking_player_update(old.organization_id,null,repeat('f',64),edit,gen_random_uuid()); exception when raise_exception then denied:=true; end;
  assert denied,'Different guest credential cannot edit a guest participant';

 end loop;
 assert not has_function_privilege('anon','public.dvc_booking_player_update(uuid,uuid,text,jsonb,uuid)','EXECUTE'),'Anon cannot bypass the owner-edit API';
 assert not has_function_privilege('authenticated','public.dvc_booking_player_update(uuid,uuid,text,jsonb,uuid)','EXECUTE'),'Authenticated cannot bypass the owner-edit API';
 assert has_function_privilege('service_role','public.dvc_booking_player_update(uuid,uuid,text,jsonb,uuid)','EXECUTE'),'Service role can call the fenced owner-edit RPC';
 assert not has_function_privilege('service_role','public.dvc_checkout_json(uuid)','EXECUTE'),'Unscoped assembler stays private even from the service Data API';
 raise notice 'Unified registration and owner-edit developer SQL assertions PASS';
end $test$;
set local role anon;
do $$ begin
 begin perform public.dvc_booking_player_update('00000000-0000-0000-0000-000000000001',null,repeat('a',64),'{}',gen_random_uuid()); raise exception 'Unexpected anonymous RPC access';
 exception when insufficient_privilege then raise notice 'Direct anonymous owner-edit RPC denied'; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
 begin perform public.dvc_booking_player_update('00000000-0000-0000-0000-000000000001',null,repeat('a',64),'{}',gen_random_uuid()); raise exception 'Unexpected authenticated RPC access';
 exception when insufficient_privilege then raise notice 'Direct authenticated owner-edit RPC denied'; end;
end $$;
reset role;
rollback;
