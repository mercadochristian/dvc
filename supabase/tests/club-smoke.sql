-- Run only against a dedicated development project after the initial migration.
-- Assertions fail the transaction; successful fixture writes are rolled back.
begin;
do $test$
declare
 org uuid:='00000000-0000-0000-0000-000000000001'; game uuid:=gen_random_uuid();
 method uuid:=gen_random_uuid(); booking uuid; team_booking uuid; result jsonb;
 rejected boolean; guest1 text:=repeat('a',64); guest2 text:=repeat('b',64);
begin
 insert into games(id,organization_id,venue,city,starts_at,ends_at,status,team_price)
 values(game,org,'DVC integration rollback fixture','Test only',now()+interval '2 days',now()+interval '2 days 3 hours','published',120000);
 insert into game_positions(game_id,position,capacity,price)
 select game,p,case when p in ('open','middle') then 2 else 1 end,20000 from unnest(array['open','opposite','middle','setter']) p;
 insert into payment_methods(id,organization_id,label,account_name,account_number)
 values(method,org,'TEST ONLY','TEST ONLY','NOT A BANK ACCOUNT');
 result:=dvc_hold(org,null,guest1,jsonb_build_object('level','intermediate','age',25,'gender','prefer_not_to_say','game_id',game,'kind','team','position','setter','name','Test Captain','contact','test@example.invalid'),gen_random_uuid());
 team_booking:=(result->>'id')::uuid;
 assert (select count(*)=6 from roster_entries where booking_id=team_booking), 'Team must create six entries';
 assert (select count(*)=1 from roster_entries where booking_id=team_booking and name='Test Captain' and position='setter'), 'Captain position';
 assert (select count(*)=5 from roster_entries where booking_id=team_booking and name is null), 'Five placeholders';
 assert (result->>'amount')::int=120000,'Team total price';
 assert not (result ? 'guest_hash') and not (result ? 'contact'),'Hold output privacy';
 rejected:=false;
 begin perform dvc_hold(org,null,guest2,jsonb_build_object('level','intermediate','age',25,'gender','prefer_not_to_say','game_id',game,'kind','individual','position','setter','name','Second','contact','test@example.invalid'),gen_random_uuid()); exception when raise_exception then rejected:=true; end;
 assert rejected,'Full team must exhaust capacity';
 assert (select count(*)=1 from bookings where game_id=game),'Failed hold atomicity';
 assert not dvc_owned(org,null,guest2,team_booking),'Guest owner isolation';
 assert jsonb_array_length(dvc_bookings(org,null,guest2))=0,'Guest booking read isolation';
 update bookings set expires_at=now()-interval '1 minute' where id=team_booking;
 rejected:=false;
 begin perform dvc_receipt(org,null,guest1,team_booking,method,'receipts/'||team_booking||'/'||gen_random_uuid()||'.png',gen_random_uuid()); exception when raise_exception then rejected:=true; end;
 assert rejected,'Expired receipt denied';
 result:=dvc_hold(org,null,guest2,jsonb_build_object('level','intermediate','age',25,'gender','prefer_not_to_say','game_id',game,'kind','individual','position','setter','name','Test Player Fullname','contact','test@example.invalid'),gen_random_uuid());
 booking:=(result->>'id')::uuid;
 assert (select status='expired' from bookings where id=team_booking),'Expired hold frees capacity';
 assert (result->>'amount')::int=20000,'Position price';
 rejected:=false;
 begin perform dvc_receipt(org,null,guest1,booking,method,'receipts/'||booking||'/'||gen_random_uuid()||'.png',gen_random_uuid()); exception when raise_exception then rejected:=true; end;
 assert rejected,'Other guest cannot submit receipt';
 perform dvc_receipt(org,null,guest2,booking,method,'receipts/'||booking||'/'||gen_random_uuid()||'.png',gen_random_uuid());
 perform dvc_receipt(org,null,guest2,booking,method,'receipts/'||booking||'/'||gen_random_uuid()||'.png',gen_random_uuid());
 assert (select status='reserved' and payment_status='pending' from bookings where id=booking),'Receipt reserves before approval';
 assert (select count(*)=1 from receipts where booking_id=booking),'Receipt idempotency';
 assert dvc_roster(org,game)->0->>'name'='Test','Public roster first name only';
 assert dvc_role(org,null)='player','Unauthenticated role';
 rejected:=false;
 begin perform dvc_admin(org,null,'game.cancel',jsonb_build_object('id',game),gen_random_uuid()); exception when raise_exception then rejected:=true; end;
 assert rejected,'Unauthenticated admin denied';
 assert (select count(*)>=3 from developer_events where entity_id in (booking,team_booking)),'Activity audit persistence';
 assert (select bool_and(rowsecurity) from pg_tables where schemaname='public'),'RLS enabled';
 assert not has_table_privilege('anon','public.bookings','SELECT'),'Anon table denied';
 assert not has_table_privilege('authenticated','public.staff_email_whitelist','INSERT'),'Authenticated whitelist denied';
 assert not has_function_privilege('anon','public.dvc_hold(uuid,uuid,text,jsonb,uuid)','EXECUTE'),'Anon RPC denied';
 assert not has_function_privilege('authenticated','public.dvc_admin(uuid,uuid,text,jsonb,uuid)','EXECUTE'),'Authenticated admin RPC denied';
 assert (select not public and file_size_limit=3145728 from storage.buckets where id='dvc-private'),'Private storage limits';
end $test$;
select 'PASS: team/individual pricing, capacity atomicity, guest isolation, hold expiry, receipt reservation/idempotency, public privacy, audit, unauthenticated denial, RLS and RPC grants; all fixture writes rolled back' as result;
rollback;
