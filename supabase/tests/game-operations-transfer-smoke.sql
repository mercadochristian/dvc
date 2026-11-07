-- Run as the database owner on a fresh isolated developer database.
-- The internal transfer and the public RPC's denial are checked separately.
begin;
do $test$
declare
 org uuid:=gen_random_uuid(); src uuid:=gen_random_uuid(); dst uuid:=gen_random_uuid();
 checkout uuid:=gen_random_uuid(); group_booking uuid:=gen_random_uuid();
 team_booking uuid:=gen_random_uuid(); sibling uuid:=gen_random_uuid();
 method uuid:=gen_random_uuid(); upload uuid:=gen_random_uuid(); path text;
 checkout_before jsonb; sibling_before jsonb; receipt_before jsonb; denied boolean;
begin
 insert into organizations(id,name) values(org,'Transfer QA');
 insert into games(id,organization_id,venue,city,starts_at,ends_at,status,team_count,team_price,team_discount_price)
 select id,org,'Transfer QA Court','TEST',now()+interval '4 days',now()+interval '4 days 2 hours','published',4,165000,150000
 from unnest(array[src,dst]) id;
 insert into game_positions(game_id,position,capacity,price,discount_price)
 select id,pos,case when pos in ('open','middle') then 8 else 4 end,30000,25000
 from unnest(array[src,dst]) id cross join unnest(array['open','middle','opposite','setter']) pos;
 insert into checkouts(id,organization_id,guest_hash,request_id,request_fingerprint,organizer_name,contact,organizer_email,amount,status,payment_status,expires_at)
 values(checkout,org,repeat('a',64),gen_random_uuid(),repeat('b',64),'QA Organizer','organizer@example.test','organizer@example.test',225000,'reserved','approved',now());
 insert into bookings(id,organization_id,game_id,guest_hash,kind,captain_name,contact,amount,status,payment_status,checkout_id)
 values
 (group_booking,org,src,repeat('a',64),'group','QA Group','organizer@example.test',50000,'reserved','approved',checkout),
 (team_booking,org,src,repeat('a',64),'team','QA Team','organizer@example.test',150000,'reserved','approved',checkout),
 (sibling,org,src,repeat('a',64),'individual','QA Sibling','organizer@example.test',25000,'reserved','approved',checkout);
 insert into roster_entries(booking_id,position,team)
 select group_booking,'open',null from generate_series(1,2)
 union all select team_booking,pos,case when idx<=6 then 1 end
 from unnest(array['open','open','opposite','middle','middle','setter','open']) with ordinality positions(pos,idx);
 insert into payment_methods(id,organization_id,label,account_name,account_number) values(method,org,'QA','QA','DO NOT PAY');
 path:='checkout-receipts/'||checkout||'/'||upload||'.png';
 insert into checkout_receipt_uploads(id,checkout_id,method_id,path,state) values(upload,checkout,method,path,'committed');
 insert into checkout_receipts(checkout_id,upload_id,method_id,path) values(checkout,upload,method,path);
 select to_jsonb(c) into checkout_before from checkouts c where id=checkout;
 select to_jsonb(b) into sibling_before from bookings b where id=sibling;
 select to_jsonb(r) into receipt_before from checkout_receipts r where checkout_id=checkout;

 denied:=false;
 begin
  perform dvc_admin(org,null,'booking.transfer',jsonb_build_object('id',group_booking,'game_id',dst),gen_random_uuid());
 exception when raise_exception then denied:=SQLERRM='Access denied';
 end;
 assert denied,'Public staff operation denies an actor without staff privileges';
 assert not has_function_privilege('service_role','public.dvc_transfer_reserved_booking(uuid,uuid,uuid)','execute'),'Service role cannot bypass the staff wrapper';

 update game_positions set capacity=1 where game_id=dst and position='open';
 denied:=false;
 begin perform dvc_transfer_reserved_booking(org,group_booking,dst);
 exception when raise_exception then denied:=SQLERRM='Destination game has insufficient positions';
 end;
 assert denied,'Repeated positions require their full capacity';
 update game_positions set capacity=8,discount_price=20000 where game_id=dst and position='open';
 denied:=false;
 begin perform dvc_transfer_reserved_booking(org,group_booking,dst);
 exception when raise_exception then denied:=SQLERRM='Destination game must have the same booking price';
 end;
 assert denied,'Group price includes every effective position price';
 assert (select game_id=src from bookings where id=group_booking),'Failed transfer keeps the source booking';
 update game_positions set discount_price=25000 where game_id=dst and position='open';

 assert dvc_transfer_reserved_booking(org,group_booking,dst)=group_booking;
 assert dvc_transfer_reserved_booking(org,team_booking,dst)=team_booking;
 assert (select count(*)=2 from bookings where id in (group_booking,team_booking) and game_id=dst);
 assert (select count(*)=7 and count(team)=6 and count(distinct team)=1 from roster_entries where booking_id=team_booking),'Extras stay unassigned';
 assert (select to_jsonb(c)=checkout_before from checkouts c where id=checkout);
 assert (select to_jsonb(b)=sibling_before from bookings b where id=sibling);
 assert (select to_jsonb(r)=receipt_before from checkout_receipts r where checkout_id=checkout);
end $test$;
rollback;
