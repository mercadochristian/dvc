-- ISOLATED LOCAL DATABASE ONLY. Synthetic Auth identities below are never for a
-- shared Supabase project. Outbox persistence/leases only; no external mail sends.
begin;
do $test$
declare
 org uuid:='00000000-0000-0000-0000-000000000001';
 adm uuid:='22222222-2222-4222-8222-000000000001'; coord uuid:='22222222-2222-4222-8222-000000000002'; player uuid:='22222222-2222-4222-8222-000000000003';
 venue uuid:=gen_random_uuid(); game uuid:=gen_random_uuid(); payment uuid:=gen_random_uuid();
 booking uuid; manual_booking uuid; no_email_booking uuid; payload jsonb; profile jsonb; result jsonb; claims jsonb;
 first_id uuid; second_id uuid; old_lease uuid; next_lease uuid; current_lease uuid; second_lease uuid; stable_key text; snapshot jsonb; denied boolean;
begin
 insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 (adm,'admin@example.invalid',now(),'{}'),(coord,'coord@example.invalid',now(),'{}'),(player,'player@example.invalid',now(),'{}');
 insert into auth.identities(user_id,provider,provider_id,identity_data)
 select id,'google',id::text,jsonb_build_object('email',email,'email_verified',true) from auth.users;
 insert into staff_email_whitelist(organization_id,email,role) values(org,'admin@example.invalid','admin'),(org,'coord@example.invalid','coordinator');
 insert into venues(id,organization_id,name,city) values(venue,org,'Synthetic email court','TEST');
 insert into games(id,organization_id,venue,city,venue_id,starts_at,ends_at,status,team_price,team_count)
 values(game,org,'Synthetic email court','TEST',venue,now()+interval '2 days',now()+interval '2 days 3 hours','published',120000,6);
 insert into game_positions(game_id,position,capacity,price)
 select game,p,case when p in ('open','middle') then 12 else 6 end,20000 from unnest(array['open','opposite','middle','setter']) p;
 insert into payment_methods(id,organization_id,label,account_name,account_number) values(payment,org,'TEST ONLY','NOT A REAL ACCOUNT','DO NOT PAY');
 profile:=jsonb_build_object('level','intermediate','gender','female','birth_date','2000-02-29','first_timer',false);
 payload:=jsonb_build_object('game_id',game,'kind','team','organizer_plays',false,'name','Private organizer name','contact','phone-private','organizer_email','ORGANIZER@EXAMPLE.INVALID','teammates',jsonb_build_array(
  profile||jsonb_build_object('name','Private teammate one','position','open','email','organizer@example.invalid'),
  profile||jsonb_build_object('name','Private teammate two','position','open','email','TEAMMATE@EXAMPLE.INVALID')));
 result:=dvc_hold(org,null,repeat('a',64),payload,gen_random_uuid());booking:=(result->>'id')::uuid;
 -- An unnamed placeholder with a legacy email must never become a recipient.
 update roster_entries set email='unnamed@example.invalid' where booking_id=booking and name is null and position='setter';
 assert not exists(select 1 from booking_confirmation_outbox where booking_id=booking),'A hold never queues a confirmation';
 assert dvc_enqueue_confirmation(booking)=0,'Explicit enqueue also rejects a receipt-less hold';
 perform dvc_receipt(org,null,repeat('a',64),booking,payment,'receipts/'||booking||'/'||gen_random_uuid()||'.png',gen_random_uuid());
 assert (select status='reserved' and payment_status='pending' from bookings where id=booking),'Receipt reserves booking independently of email delivery';
 assert (select count(*)=2 from booking_confirmation_outbox where booking_id=booking),'Organizer and one distinct named-player address queue once';
 assert (select count(*)=1 from booking_confirmation_outbox where booking_id=booking and recipient='organizer@example.invalid'),'Case-insensitive organizer/team overlap deduplicated';
 assert exists(select 1 from booking_confirmation_outbox where booking_id=booking and recipient='teammate@example.invalid'),'Named teammate address normalized';
 assert not exists(select 1 from booking_confirmation_outbox where recipient='unnamed@example.invalid'),'Unnamed placeholder is never emailed';
 assert not exists(select 1 from booking_confirmation_outbox where booking_id=booking and (status<>'pending' or attempt_count<>0)),'Rows remain pending without a configured provider';
 assert not exists(select 1 from booking_confirmation_outbox o cross join lateral jsonb_object_keys(o.payload) k where o.booking_id=booking and k not in ('booking_reference','kind','status','payment_status','venue','starts_at','ends_at','time_zone')),'Email payload contains only the allowed schedule/reference fields';
 assert not exists(select 1 from booking_confirmation_outbox o where booking_id=booking and o.payload::text like '%Private%'),'No player or organizer names leak into schedule payload';
 assert not exists(select 1 from booking_confirmation_outbox o where booking_id=booking and o.payload ?| array['birth_date','age','gender','level','contact','organizer_email','email','amount','receipt','account_name','account_number','guest_hash','user_id']),'Private profiles, contacts and payment details excluded';
 select o.payload into snapshot from booking_confirmation_outbox o where booking_id=booking limit 1;
 assert snapshot->>'booking_reference'=booking::text and snapshot->>'kind'='team' and snapshot->>'status'='reserved' and snapshot->>'payment_status'='pending','Payload distinguishes reservation from payment approval';
 assert snapshot->>'venue'='Synthetic email court' and snapshot->>'time_zone'='Asia/Manila','Payload includes venue and timezone';
 assert (snapshot->>'starts_at')::timestamptz=(select starts_at from games where id=game) and (snapshot->>'ends_at')::timestamptz=(select ends_at from games where id=game),'Payload preserves exact schedule timestamps';
 perform dvc_receipt(org,null,repeat('a',64),booking,payment,'receipts/'||booking||'/'||gen_random_uuid()||'.png',gen_random_uuid());
 assert (select count(*)=2 from booking_confirmation_outbox where booking_id=booking),'Repeated receipt request cannot queue duplicates';
 assert dvc_enqueue_confirmation(booking)=0,'Repeated enqueue reports no new recipient events';
 update games set venue='Updated synthetic venue' where id=game;
 assert (select o.payload=snapshot from booking_confirmation_outbox o where booking_id=booking limit 1),'Queued confirmation is a durable immutable event snapshot';

 -- Manual reservation has no confirmation until an administrator attaches a receipt.
 result:=profile||jsonb_build_object('game_id',game,'kind','individual','position','setter','name','Manual player','contact','manual@example.invalid');
 manual_booking:=dvc_admin(org,coord,'manual.register',result,gen_random_uuid());
 assert (select status='reserved' and manual from bookings where id=manual_booking),'Manual registration is already reserved';
 assert not exists(select 1 from booking_confirmation_outbox where booking_id=manual_booking),'Manual reservation without receipt never queues';
 perform dvc_receipt(org,adm,null,manual_booking,payment,'receipts/'||manual_booking||'/'||gen_random_uuid()||'.png',gen_random_uuid());
 assert (select count(*)=1 from booking_confirmation_outbox where booking_id=manual_booking and recipient='manual@example.invalid'),'Manual receipt queues once using supplied email contact fallback';
 update bookings set status='cancelled' where id=manual_booking;

 -- Missing/invalid legacy recipient data never stops the reservation operation.
 result:=dvc_hold(org,null,repeat('b',64),jsonb_build_object('game_id',game,'kind','team','organizer_plays',false,'name','Phone organizer','contact','phone-only'),gen_random_uuid());no_email_booking:=(result->>'id')::uuid;
 update roster_entries set email='not-an-email',name='Legacy named player' where booking_id=no_email_booking and position='setter';
 perform dvc_receipt(org,null,repeat('b',64),no_email_booking,payment,'receipts/'||no_email_booking||'/'||gen_random_uuid()||'.png',gen_random_uuid());
 assert (select status='reserved' from bookings where id=no_email_booking),'No usable email does not undo reservation';
 assert not exists(select 1 from booking_confirmation_outbox where booking_id=no_email_booking),'No recipient is invented for phone-only/invalid legacy details';

 -- Service-only lease contracts keep active/sent work from duplicate claims.
 denied:=false;
 begin perform dvc_claim_confirmations(org,0,120); exception when raise_exception then denied:=true; end;
 assert denied,'Claim batch limit must be positive';
 denied:=false;
 begin perform dvc_claim_confirmations(org,1,1); exception when raise_exception then denied:=true; end;
 assert denied,'Lease duration is bounded';
 claims:=dvc_claim_confirmations(org,1,120);
 assert jsonb_array_length(claims)=1,'Worker claims only requested batch size';
 first_id:=(claims->0->>'id')::uuid;old_lease:=(claims->0->>'lease_token')::uuid;stable_key:=claims->0->>'idempotency_key';
 assert claims->0->>'status'='sending' and (claims->0->>'attempt_count')::int=1,'Claim records one delivery attempt';
 assert (claims->0->>'booking_id')::uuid=booking,'Cancelled manual reservation is not eligible to send';
 claims:=dvc_claim_confirmations(org,1,120);second_id:=(claims->0->>'id')::uuid;second_lease:=(claims->0->>'lease_token')::uuid;
 assert second_id<>first_id,'Next worker cannot claim an active lease';
 assert jsonb_array_length(dvc_claim_confirmations(org,10,120))=0,'Active leases and cancelled bookings are not re-claimed';
 assert not dvc_finish_confirmation(gen_random_uuid(),first_id,old_lease),'Another organization cannot finish a leased row';
 assert not dvc_finish_confirmation(org,first_id,gen_random_uuid()),'Wrong lease cannot mark delivery sent';
 assert dvc_fail_confirmation(org,first_id,old_lease,'raw provider response with sensitive body'),'Current worker can record a safe failure';
 assert (select status='error' and last_error_code='DELIVERY_FAILED' and lease_token is null and lease_expires_at is null from booking_confirmation_outbox where id=first_id),'Unrecognized provider text is replaced by a bounded safe error code';
 assert (select status='reserved' from bookings where id=booking) and exists(select 1 from receipts where booking_id=booking),'Delivery failure leaves booking and receipt intact';
 assert jsonb_array_length(dvc_claim_confirmations(org,10,120))=0,'Error rows do not retry automatically';
 denied:=false;
 begin perform dvc_retry_confirmation(org,coord,first_id); exception when raise_exception then denied:=true; end;
 assert denied,'Coordinator cannot retry confirmation delivery';
 denied:=false;
 begin perform dvc_retry_confirmation(org,player,first_id); exception when raise_exception then denied:=true; end;
 assert denied,'Player cannot retry confirmation delivery';
 assert dvc_retry_confirmation(org,adm,first_id),'Administrator can explicitly retry an error';
 assert not dvc_retry_confirmation(org,adm,first_id),'Pending retry cannot be repeatedly reset';
 claims:=dvc_claim_confirmations(org,1,120);next_lease:=(claims->0->>'lease_token')::uuid;
 assert (claims->0->>'id')::uuid=first_id and (claims->0->>'attempt_count')::int=2,'Retry increments existing row attempt count';
 assert claims->0->>'idempotency_key'=stable_key,'Retry reuses stable provider idempotency key';
 assert not dvc_finish_confirmation(org,first_id,old_lease),'Old worker cannot finish a newer retry lease';
 assert not dvc_fail_confirmation(org,first_id,old_lease,'DELIVERY_TIMEOUT'),'Old worker cannot overwrite a newer lease with failure';
 update booking_confirmation_outbox set lease_expires_at=now()-interval '1 second' where id=first_id;
 claims:=dvc_claim_confirmations(org,1,120);current_lease:=(claims->0->>'lease_token')::uuid;
 assert current_lease<>next_lease and (claims->0->>'attempt_count')::int=3,'Expired lease may be recovered by a new worker';
 assert claims->0->>'idempotency_key'=stable_key,'Timeout recovery preserves provider idempotency key';
 assert not dvc_finish_confirmation(org,first_id,next_lease),'Expired stale worker cannot finish recovered work';
 assert dvc_finish_confirmation(org,first_id,current_lease),'Current delivery lease can finish';
 assert (select status='sent' and sent_at is not null and lease_token is null and lease_expires_at is null from booking_confirmation_outbox where id=first_id),'Successful delivery records sent time and clears lease';
 assert not dvc_finish_confirmation(org,first_id,current_lease),'Repeated finish is not a second delivery';
 assert not dvc_retry_confirmation(org,adm,first_id),'Administrator retry never resends a sent row';
 assert jsonb_array_length(dvc_claim_confirmations(org,10,120))=0,'Sent rows never become claimable';
 assert dvc_fail_confirmation(org,second_id,second_lease,'DELIVERY_TIMEOUT'),'Recognized safe timeout code can be recorded';
 assert (select last_error_code='DELIVERY_TIMEOUT' from booking_confirmation_outbox where id=second_id),'Known error code is preserved without provider body';
 assert (select count(*)=2 from booking_confirmation_outbox where booking_id=booking),'Claims, failures and retries never duplicate outbox rows';

 assert not has_table_privilege('anon','booking_confirmation_outbox','SELECT'),'Anon cannot read recipient addresses/payloads';
 assert not has_table_privilege('authenticated','booking_confirmation_outbox','SELECT'),'Authenticated role cannot enumerate outbox';
 assert not has_table_privilege('authenticated','booking_confirmation_outbox','UPDATE'),'Authenticated role cannot mark a delivery sent';
 assert not has_function_privilege('anon','dvc_claim_confirmations(uuid,integer,integer)','EXECUTE'),'Anon cannot claim worker leases';
 assert not has_function_privilege('authenticated','dvc_enqueue_confirmation(uuid)','EXECUTE'),'Authenticated role cannot enqueue arbitrary bookings';
 assert not has_function_privilege('authenticated','dvc_finish_confirmation(uuid,uuid,uuid)','EXECUTE'),'Authenticated role cannot spoof worker delivery';
 assert not has_function_privilege('authenticated','dvc_retry_confirmation(uuid,uuid,uuid)','EXECUTE'),'Browser roles cannot spoof admin retry actor';
 assert has_function_privilege('service_role','dvc_claim_confirmations(uuid,integer,integer)','EXECUTE'),'Service worker can claim leases';
 assert (select relrowsecurity from pg_class where oid='public.booking_confirmation_outbox'::regclass),'Outbox RLS is enabled';
end $test$;
select 'PASS: receipt-only enqueue, manual receipts, recipient deduplication, safe payloads, stable idempotency keys, claim leases, admin retries, failure isolation and RLS' as result;
rollback;
