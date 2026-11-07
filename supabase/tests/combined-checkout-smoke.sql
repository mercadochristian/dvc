-- Fresh isolated database developer contracts. Storage rows below are synthetic
-- metadata only; real uploaded bytes/Auth/HTTP are verified separately by QA.
-- Everything in this file rolls back. No provider identities are fabricated.
begin;
create function pg_temp.reviewed(p_org uuid,p_data jsonb) returns jsonb language plpgsql as $$
declare quote jsonb; games jsonb; begin
 quote:=public.dvc_checkout_review(p_org,p_data);
 select jsonb_agg((value-'amount'-'venue'-'city'-'maps_url'-'starts_at'-'ends_at'-'quote')||jsonb_build_object('expected_amount',value->'amount','expected_quote',value->'quote')) into games from jsonb_array_elements(quote->'games');
 return jsonb_set(p_data,'{games}',games);
end $$;
do $test$
declare
 org uuid:=gen_random_uuid(); venue uuid:=gen_random_uuid(); game_a uuid:=gen_random_uuid(); game_b uuid:=gen_random_uuid(); game_c uuid:=gen_random_uuid();
 method uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); c_id uuid; c2_id uuid; b_id uuid; upload_a uuid:=gen_random_uuid(); upload_b uuid:=gen_random_uuid();
 owner uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid(); payload jsonb; saved_payload jsonb; result jsonb; previous jsonb;
 organizer jsonb; players jsonb; single jsonb; profile jsonb; expires timestamptz; path_a text; path_b text; denied boolean; initial_count integer; cleanup_id uuid:=gen_random_uuid(); attempt_id uuid; visited uuid[]:=array[]::uuid[]; batch integer;
begin
 insert into organizations(id,name) values(org,'M4 transactional fixture');
 insert into venues(id,organization_id,name,city) values(venue,org,'M4 synthetic court','TEST');
 insert into games(id,organization_id,venue,city,venue_id,starts_at,ends_at,status,team_count,team_price,team_discount_price)
 select g,org,'M4 synthetic court','TEST',venue,clock_timestamp()+interval '10 days',clock_timestamp()+interval '10 days 2 hours','published',10,165000,150000 from unnest(array[game_a,game_b,game_c]) g;
 insert into game_positions(game_id,position,capacity,price,discount_price)
 select g,p,case when p in ('open','middle') then 20 else 10 end,30000,case when p='setter' then 20000 else null end
 from unnest(array[game_a,game_b,game_c]) g cross join unnest(array['open','opposite','middle','setter']) p;
 insert into payment_methods(id,organization_id,label,account_name,account_number) values(method,org,'SYNTHETIC DO NOT PAY','TEST','TEST');
 insert into auth.users(id,email) values(owner,'m4-owner@example.test'),(other_owner,'m4-other@example.test');
 organizer:=jsonb_build_object('name','Synthetic organizer','contact','09123456789','email','organizer@example.test');
 players:=jsonb_build_array(jsonb_build_object('position','setter','name',null,'is_registrant',false),jsonb_build_object('position','open','name',null,'is_registrant',false));
 single:=jsonb_build_object('game_id',game_a,'kind','group','organizer_plays',false,'players',players);
 payload:=pg_temp.reviewed(org,jsonb_build_object('request_id',req,'organizer',organizer,'games',jsonb_build_array(single,single||jsonb_build_object('game_id',game_b))));
 saved_payload:=payload;
 -- A late conflict in one game creates no checkout or hold in any game.
 update game_positions set capacity=0 where game_id=game_b and position='setter';
 result:=dvc_checkout_hold(org,null,repeat('a',64),payload,gen_random_uuid());
 assert result->>'outcome'='selection_conflict','Capacity conflict is a typed no-write outcome';
 assert (select count(*)=0 from checkouts where organization_id=org),'Capacity conflict creates no checkout';
 assert (select count(*)=0 from bookings where organization_id=org),'Capacity conflict creates no partial game hold';
 update game_positions set capacity=10 where game_id=game_b and position='setter';
 result:=dvc_checkout_hold(org,null,repeat('a',64),payload,gen_random_uuid());
 assert result->>'outcome'='selection_conflict','A delayed old RPC remains declined after capacity is restored';
 assert (select count(*)=1 from checkout_declined_intents where organization_id=org),'No-hold response has a durable request tombstone';
 result:=dvc_checkout_hold(org,null,repeat('a',64),jsonb_set(payload,'{organizer,name}','"Edited request"'),gen_random_uuid());
 assert result->>'outcome'='selection_conflict','Changed input cannot reuse a declined request key to create a hold';
 assert (select count(*)=0 from bookings where organization_id=org),'Late declined replays never create a stale reservation';
 payload:=jsonb_set(payload,'{request_id}',to_jsonb(gen_random_uuid()));
 -- Equal totals do not hide compensating changes to the accepted unit prices.
 update game_positions set price=31000 where game_id=game_a and position='open';
 update game_positions set discount_price=19000 where game_id=game_a and position='setter';
 result:=dvc_checkout_hold(org,null,repeat('a',64),payload,gen_random_uuid());
 assert result->'conflicts'->0->>'code'='PRICE_CHANGED','Unit price consent is checked even when total is unchanged';
 assert (select count(*)=0 from bookings where organization_id=org),'Price conflict creates no hold';
 update game_positions set price=30000 where game_id=game_a and position='open';
 update game_positions set discount_price=20000 where game_id=game_a and position='setter';
 payload:=jsonb_set(payload,'{request_id}',to_jsonb(gen_random_uuid()));
 update games set starts_at=starts_at+interval '1 hour',ends_at=ends_at+interval '1 hour' where id=game_a;
 result:=dvc_checkout_hold(org,null,repeat('a',64),payload,gen_random_uuid());
 assert result->'conflicts'->0->>'code'='SCHEDULE_CHANGED','Changed schedule requires a fresh review';
 update games set starts_at=starts_at-interval '1 hour',ends_at=ends_at-interval '1 hour' where id=game_a;
 payload:=jsonb_set(payload,'{request_id}',to_jsonb(gen_random_uuid()));
 result:=dvc_checkout_hold(org,null,repeat('a',64),payload,gen_random_uuid());
 assert result->>'outcome'='created','All available selections create one checkout';
 c_id:=(result->'checkout'->>'id')::uuid; previous:=result->'checkout'; expires:=(previous->>'expires_at')::timestamptz;
 assert previous->>'amount'='100000','Combined amount snapshots both games';
 assert jsonb_array_length(previous->'bookings')=2,'Checkout links separate per-game booking records';
 assert (select count(distinct expires_at)=1 and min(expires_at)=expires from bookings where checkout_id=c_id),'All bookings share the original checkout expiry';
 assert expires>clock_timestamp()+interval '9 minutes 50 seconds' and expires<=clock_timestamp()+interval '10 minutes','Hold lasts ten minutes from successful confirmation';
 assert previous->>'request_id'=payload->>'request_id','Authorized checkout DTO retains its original request identity for pending-intent recovery';
 assert dvc_checkout_read(org,null,repeat('a',64),(previous->>'id')::uuid)->>'request_id'=payload->>'request_id','Authorized resume returns the same original request identity';
 assert not (previous ?| array['user_id','guest_hash','owner_key','request_fingerprint','path']),'Checkout DTO excludes internal owner/attempt state';
 assert not (previous->'bookings'->0 ?| array['user_id','guest_hash','quote_snapshot']),'Booking DTO excludes internal owner/snapshot fields';
 result:=dvc_checkout_hold(org,null,repeat('a',64),payload,gen_random_uuid());
 assert result->>'outcome'='existing' and result->'checkout'=previous,'Same intent retry returns the original checkout';
 assert (select count(*)=2 from bookings where checkout_id=c_id),'Hold retry cannot duplicate registrations';
 result:=dvc_checkout_hold(org,null,repeat('a',64),jsonb_set(payload,'{organizer,name}','"Different organizer"'),gen_random_uuid());
 assert result->>'outcome'='intent_mismatch' and result->'checkout'->>'id'=c_id::text,'Reused key resolves the owned original rather than pretending no hold';
 assert dvc_checkout_read(org,null,repeat('b',64),c_id) is null,'Another guest cannot read checkout';
 assert dvc_checkout_read(org,other_owner,repeat('a',64),c_id) is null,'Account ownership never falls back to a supplied guest cookie';
 assert dvc_checkout_read(gen_random_uuid(),null,repeat('a',64),c_id) is null,'Checkout ownership is organization scoped';
 update game_positions set price=32000 where game_id=game_a and position='open';
 assert (dvc_checkout_read(org,null,repeat('a',64),c_id)->>'amount')::int=100000,'Accepted total survives later price changes';
 assert (select quote_snapshot->'position_prices'->>'open'='30000' from bookings where checkout_id=c_id and game_id=game_a),'Accepted unit prices remain immutable';
 update game_positions set price=30000 where game_id=game_a and position='open';

 path_a:='checkout-receipts/'||c_id||'/'||upload_a||'.png'; path_b:='checkout-receipts/'||c_id||'/'||upload_b||'.png';
 perform dvc_checkout_upload_prepare(org,null,repeat('a',64),c_id,method,upload_a,path_a);
 perform dvc_checkout_upload_prepare(org,null,repeat('a',64),c_id,method,upload_b,path_b);
 assert (select expires_at=expires from checkouts where id=c_id),'Preparing/retrying upload never extends expiry';
 insert into storage.objects(bucket_id,name) values('dvc-private',path_a),('dvc-private',path_b);
 result:=dvc_checkout_receipt(org,null,repeat('a',64),c_id,upload_a,gen_random_uuid());
 assert result->>'status'='reserved' and result->>'payment_status'='approved','One receipt reserves and automatically approves checkout';
 assert (select count(*)=2 from bookings where checkout_id=c_id and status='reserved' and payment_status='approved'),'All included bookings approve atomically';
 assert (select count(*)=1 from checkout_receipts where checkout_id=c_id),'One receipt is linked to the checkout';
 result:=dvc_checkout_receipt(org,null,repeat('a',64),c_id,upload_b,gen_random_uuid());
 assert result->>'status'='reserved','Concurrent losing submission is idempotent';
 assert (select count(*)=1 from checkout_receipts where checkout_id=c_id),'Duplicate receipt submission adds no extra receipt';
 result:=dvc_checkout_upload_release(org,null,repeat('a',64),c_id,upload_a,true);
 assert result->>'committed'='true' and not (result ? 'path'),'Committed upload is recovered as success and never released';
 result:=dvc_checkout_upload_release(org,null,repeat('a',64),c_id,upload_b,true);
 assert result->>'committed'='false' and result->>'path'=path_b,'Only an unused upload is safely released';
 assert (select state='discarded' from checkout_receipt_uploads where id=upload_b),'Discard fences future finalization of unused attempt';
 assert exists(select 1 from storage.objects where bucket_id='dvc-private' and name=path_a),'Committed receipt metadata remains intact';

 -- More than one batch of retained tombstones must progress even when reads
 -- are slower than the cooldown. Simulate elapsed cooldown instead of sleeping.
 insert into checkouts(id,organization_id,guest_hash,request_id,request_fingerprint,organizer_name,contact,organizer_email,amount,expires_at)
 values(cleanup_id,org,repeat('d',64),gen_random_uuid(),repeat('e',64),'Cleanup fixture','TEST','cleanup@example.test',0,clock_timestamp());
 insert into checkout_receipt_uploads(id,checkout_id,method_id,path,state,cleanup_after,created_at)
 select id,cleanup_id,method,'checkout-receipts/'||cleanup_id||'/'||id||'.png','discarded',clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 day'+n*interval '1 second'
 from (select gen_random_uuid() id,n from generate_series(1,45) n) fixtures;
 for batch in 1..3 loop
  result:=dvc_checkout_cleanup_candidates(org,null,repeat('d',64),cleanup_id);
  assert jsonb_array_length(result)=20,'Cleanup keeps its bounded batch size';
  for attempt_id in select (value->>'id')::uuid from jsonb_array_elements(result) loop
   if not attempt_id=any(visited) then visited:=array_append(visited,attempt_id); end if;
   perform dvc_checkout_cleanup_checked(org,null,repeat('d',64),cleanup_id,attempt_id);
  end loop;
  -- Previously visited attempts become eligible again before the next read.
  update checkout_receipt_uploads set checked_at=checked_at-interval '2 minutes' where checkout_id=cleanup_id and checked_at is not null;
 end loop;
 assert cardinality(visited)=45,'Slow periodic cleanup visits all attempts instead of starving later batches';
 assert (select count(*)=45 and count(checked_at)=45 from checkout_receipt_uploads where checkout_id=cleanup_id),'All cleanup tombstones remain available for late Storage writes';
 -- Once every row has been visited, prioritize the least recently checked.
 update checkout_receipt_uploads set checked_at=clock_timestamp()-interval '2 minutes' where checkout_id=cleanup_id;
 update checkout_receipt_uploads set checked_at=clock_timestamp()-interval '1 hour' where id=visited[45];
 result:=dvc_checkout_cleanup_candidates(org,null,repeat('d',64),cleanup_id);
 assert result->0->>'id'=visited[45]::text,'Previously checked cleanup attempts are revisited least-recently-checked first';

 -- One booking cancellation leaves immutable checkout payment and siblings alone.
 select id into b_id from bookings where checkout_id=c_id order by id limit 1;
 update bookings set status='cancelled' where id=b_id;
 assert (dvc_checkout_read(org,null,repeat('a',64),c_id)->>'amount')::int=100000,'Historical accepted total is not recomputed after a cancellation';
 assert (select count(*)=1 from bookings where checkout_id=c_id and status='reserved' and payment_status='approved'),'Other checkout bookings remain reserved and approved';

 -- Discard before a delayed receipt RPC prevents a future commit using a deleted object.
 payload:=pg_temp.reviewed(org,jsonb_set(saved_payload,'{request_id}',to_jsonb(gen_random_uuid())));
 result:=dvc_checkout_hold(org,null,repeat('c',64),payload,gen_random_uuid()); c2_id:=(result->'checkout'->>'id')::uuid;
 upload_a:=gen_random_uuid(); path_a:='checkout-receipts/'||c2_id||'/'||upload_a||'.png';
 perform dvc_checkout_upload_prepare(org,null,repeat('c',64),c2_id,method,upload_a,path_a);
 perform dvc_checkout_upload_release(org,null,repeat('c',64),c2_id,upload_a,true);
 denied:=false; begin perform dvc_checkout_receipt(org,null,repeat('c',64),c2_id,upload_a,gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied,'Released attempt can never commit in a delayed RPC';
 assert not exists(select 1 from checkout_receipts where checkout_id=c2_id),'Released attempt does not partially reserve checkout';
 update checkouts set expires_at=clock_timestamp()-interval '1 second' where id=c2_id;
 update bookings set expires_at=(select expires_at from checkouts where id=c2_id) where checkout_id=c2_id;
 result:=dvc_checkout_hold(org,null,repeat('c',64),payload,gen_random_uuid());
 assert result->>'outcome'='existing' and result->'checkout'->>'status'='expired','Retry of expired intent returns original expired checkout';
 assert (select count(*)=1 from checkouts where id=c2_id),'Expiry retry never creates a replacement checkout';

 -- Force a database failure after receipt insertion has begun: the receipt,
 -- attempt state and every child reservation must roll back together.
 payload:=pg_temp.reviewed(org,jsonb_set(saved_payload,'{request_id}',to_jsonb(gen_random_uuid())));
 result:=dvc_checkout_hold(org,null,repeat('d',64),payload,gen_random_uuid()); c2_id:=(result->'checkout'->>'id')::uuid;
 upload_a:=gen_random_uuid(); path_a:='checkout-receipts/'||c2_id||'/'||upload_a||'.png';
 perform dvc_checkout_upload_prepare(org,null,repeat('d',64),c2_id,method,upload_a,path_a);
 insert into storage.objects(bucket_id,name) values('dvc-private',path_a);
 execute 'create function pg_temp.fail_checkout_update() returns trigger language plpgsql as $body$ begin raise exception ''Synthetic reservation failure''; end $body$';
 execute format('create trigger synthetic_checkout_failure before update of status on public.bookings for each row when (new.checkout_id=%L::uuid and new.status=''reserved'') execute function pg_temp.fail_checkout_update()',c2_id);
 denied:=false; begin perform dvc_checkout_receipt(org,null,repeat('d',64),c2_id,upload_a,gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied,'Injected database failure reaches the actual reservation transaction';
 assert not exists(select 1 from checkout_receipts where checkout_id=c2_id),'Database failure rolls back the receipt insertion';
 assert (select count(*)=2 from bookings where checkout_id=c2_id and status='holding' and payment_status='pending'),'Database failure leaves every game holding and pending';
 assert (select state='pending' from checkout_receipt_uploads where id=upload_a),'Database failure rolls back the committed attempt state';
 execute 'drop trigger synthetic_checkout_failure on public.bookings';
 result:=dvc_checkout_receipt(org,null,repeat('d',64),c2_id,upload_a,gen_random_uuid());
 assert result->>'status'='reserved','Same tracked receipt can retry successfully after database recovery';

 -- The authenticated organizer is a player only in the flagged actual slot.
 profile:=jsonb_build_object('position','open','name','Synthetic organizer','is_registrant',true,'birth_date','1995-04-12','level','intermediate','gender','female','first_timer',true);
 payload:=pg_temp.reviewed(org,jsonb_build_object('request_id',gen_random_uuid(),'organizer',organizer,'games',jsonb_build_array(jsonb_build_object('game_id',game_c,'kind','individual','organizer_plays',true,'players',jsonb_build_array(profile)))));
 result:=dvc_checkout_hold(org,owner,null,payload,gen_random_uuid());
 assert exists(select 1 from player_profiles where organization_id=org and user_id=owner and name='Synthetic organizer'),'Only authenticated registrant profile is saved';
 assert (select count(*)=1 from player_profiles where organization_id=org),'Teammate/organizer-only bookings never overwrite unrelated profiles';
 denied:=false; begin perform dvc_checkout_hold(org,owner,repeat('a',64),payload,gen_random_uuid()); exception when raise_exception then denied:=true; end;
 assert denied,'Authenticated checkout cannot add guest fallback ownership';
 assert not has_function_privilege('anon','public.dvc_checkout_hold(uuid,uuid,text,jsonb,uuid)','EXECUTE'),'Anonymous direct mutation RPC denied';
 assert not has_function_privilege('authenticated','public.dvc_checkout_receipt(uuid,uuid,text,uuid,uuid,uuid)','EXECUTE'),'Authenticated direct receipt RPC denied';
 assert not has_function_privilege('service_role','public.dvc_checkout_json(uuid)','EXECUTE'),'Unscoped internal DTO assembler is not a callable Data API';
 raise notice 'M4 combined checkout transaction assertions PASS';
end $test$;
rollback;
