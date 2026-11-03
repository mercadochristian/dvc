-- DEVELOPMENT ONLY. Synthetic club data; never real payments or user identities.
-- Run only on dvc-development. Stable IDs make reruns preserve staff edits.
begin;
do $seed$
declare
 org uuid:='00000000-0000-0000-0000-000000000001'; week_start date:=date_trunc('week',now() at time zone 'Asia/Manila')::date;
 v uuid; g uuid; b uuid; result_id uuid; i int; j int; k int:=0; game_index int; team_booking boolean; pos text; named text; birth date; years int;
 names text[]:=array['Mara Santos','Luis Rivera','Bea Cruz','Nico Reyes','Jules Ramos','Alex Tan','Rina Flores','Paolo Garcia','Sam Mendoza','Dani Lim','Miguel Torres','Toni Aquino','Ella Navarro','Marco Diaz','Kai Villanueva','Lea Castillo','Ivan Bautista','Pat Flores','Ren Santos','Max Rivera'];
 levels text[]:=array['developmental','developmental_plus','intermediate','intermediate_plus','advanced'];
 positions text[]:=array['open','open','opposite','middle','middle','setter'];
begin
 if not exists(select 1 from organizations where id=org) then raise exception 'DVC organization missing'; end if;
 for i in 1..3 loop
  v:=('d3c00000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
  insert into venues(id,organization_id,name,city,maps_url) values(v,org,(array['Sample · Riverside Court','Sample · Northside Gym','Sample · Club Training Hall'])[i],(array['Makati','Pasig','Quezon City'])[i],'https://www.google.com/maps/search/?api=1&query='||(array['Makati','Pasig','Quezon+City'])[i]) on conflict(id) do nothing;
 end loop;
 for i in 1..5 loop
  v:=('d3c00000-0000-4000-8000-'||lpad((((i-1)%3)+1)::text,12,'0'))::uuid;
  g:=('d3c10000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
  result_id:=null;
  insert into games(id,organization_id,venue_id,venue,city,starts_at,ends_at,status,team_price,team_count)
   select g,org,v,ve.name,ve.city,((week_start+(array[2,4,6,9,11])[i])+time '18:30') at time zone 'Asia/Manila',((week_start+(array[2,4,6,9,11])[i])+time '21:30') at time zone 'Asia/Manila',case when i=5 then 'draft' else 'published' end,165000,4 from venues ve where ve.id=v
   on conflict(id) do nothing returning id into result_id;
  if result_id is not null then
   insert into game_positions(game_id,position,capacity,price) select g,p,case when p in ('open','middle') then 8 else 4 end,case when p='setter' then 25000 else 30000 end from unnest(array['open','opposite','middle','setter']) p;
  end if;
 end loop;
 -- Two whole teams and eighteen individuals; all staff-managed and payment pending.
 for i in 1..20 loop
  game_index:=case when i<=9 then 1 when i<=14 then 2 else 3 end;
  team_booking:=i in (1,10);
  g:=('d3c10000-0000-4000-8000-'||lpad(game_index::text,12,'0'))::uuid;
  b:=('d3c20000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
  result_id:=null;
  pos:=case when team_booking then 'setter' else positions[((i-1)%6)+1] end;
  insert into bookings(id,organization_id,game_id,guest_hash,kind,captain_name,contact,amount,status,manual)
   values(b,org,g,md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text),case when team_booking then 'team' else 'individual' end,names[i],'sample-player-'||i||'@example.invalid',case when team_booking then 165000 when pos='setter' then 25000 else 30000 end,'reserved',true)
   on conflict(id) do nothing returning id into result_id;
  if result_id is null then continue; end if;
  for j in 1..(case when team_booking then 6 else 1 end) loop
   k:=i*10+j;
   named:=case when not team_booking or j=6 then names[i] when j<=3 then names[((i+j-1)%20)+1] else null end;
   birth:=case when named is not null and i%3=0 then make_date(2000+(i%5),2,15) else null end;
   years:=case when named is null then null when birth is null then 18+i else extract(year from age((select (starts_at at time zone 'Asia/Manila')::date from games where id=g),birth))::int end;
   insert into roster_entries(id,booking_id,position,name,team,is_registrant,level,gender,age,birth_date)
    values(('d3c30000-0000-4000-8000-'||lpad(k::text,12,'0'))::uuid,b,case when team_booking then positions[j] else pos end,named,case when team_booking then 1 else null end,(team_booking and j=6) or not team_booking,case when named is not null then levels[((i+j-1)%5)+1] end,case when named is null then null else (array['male','female','prefer_not_to_say'])[((i+j-1)%3)+1] end,years,birth);
  end loop;
 end loop;
 insert into payment_methods(id,organization_id,label,account_name,account_number,enabled)
 values('d3c50000-0000-4000-8000-000000000001',org,'Sample payment method — do not pay','DEMO ONLY','NOT A REAL PAYMENT ACCOUNT',true) on conflict(id) do nothing;
end $seed$;
commit;
