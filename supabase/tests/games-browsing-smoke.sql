-- Dedicated isolated fresh developer DB only. Apply full draft chain first.
-- Owned fixtures are transaction-only; no reset, deletion or external effects.
begin;
do $test$
declare
 org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); venue uuid:=gen_random_uuid(); hidden_venue uuid:=gen_random_uuid();
 anchor timestamptz:='2026-11-04T04:00:00Z'; ids uuid[]:='{}'; g uuid; ongoing uuid:=gen_random_uuid(); historical uuid:=gen_random_uuid(); cancelled uuid:=gen_random_uuid(); draft uuid:=gen_random_uuid(); foreign_game uuid:=gen_random_uuid();
 seen uuid[]:='{}'; page jsonb; second jsonb; key jsonb; selected jsonb; item jsonb; n integer;
begin
 insert into organizations(id,name) values(org,'Browse rollback fixture'),(other_org,'Other tenant rollback fixture');
 insert into venues(id,organization_id,name,city,enabled) values(venue,org,'Browse court','Test city',false),(hidden_venue,org,'Private draft court','Test city',true);
 for n in 1..25 loop
  g:=gen_random_uuid(); ids:=array_append(ids,g);
  insert into games(id,organization_id,venue_id,venue,city,starts_at,ends_at,status,team_price)
  values(g,org,venue,'Browse court','Test city',anchor+interval '1 day',anchor+interval '1 day 3 hours','published',120000);
  insert into game_positions(game_id,position,capacity,price,discount_price) values(g,'open',2,25000,20000),(g,'setter',0,25000,null);
 end loop;
 insert into games(id,organization_id,venue_id,venue,city,starts_at,ends_at,status,team_price) values
 (ongoing,org,venue,'Browse court','Test city',anchor-interval '1 hour',anchor+interval '1 hour','published',120000),
 (historical,org,venue,'Browse court','Test city',anchor-interval '1 day',anchor-interval '21 hours','published',120000),
 (cancelled,org,venue,'Browse court','Test city',anchor+interval '2 days',anchor+interval '2 days 3 hours','cancelled',120000),
 (draft,org,hidden_venue,'Private draft court','Test city',anchor+interval '1 day',anchor+interval '1 day 3 hours','draft',120000),
 (foreign_game,other_org,null,'Other court','Other city',anchor+interval '1 day',anchor+interval '1 day 3 hours','published',120000);
 page:=dvc_games_browse(org,anchor);
 assert jsonb_array_length(page->'games')=12,'Page bounded to twelve';
 assert (page->'games'->0->>'id')::uuid=ongoing,'Ongoing before upcoming';
 assert page->'next_key'<>'null','Next cursor when more matches';
 key:=page->'next_key';
 second:=dvc_games_browse(org,anchor,null,null,false,false,'',null,(key->>'bucket')::int,(key->>'starts_at')::timestamptz,(key->>'id')::uuid);
 assert jsonb_array_length(second->'games')=12,'Second bounded page';
 assert not exists(select 1 from jsonb_array_elements(page->'games') a join jsonb_array_elements(second->'games') b on a->>'id'=b->>'id'),'Equal-time UUID pagination no overlap';
 assert (second->'games'->0->>'id')::uuid>(page->'games'->11->>'id')::uuid,'Unique tie breaker';
 -- Traverse across future/history boundary and prove no skip/repeat among all28.
 page:=dvc_games_browse(org,anchor,null,null,true,true);
 loop
  for item in select value from jsonb_array_elements(page->'games') loop
   assert not ((item->>'id')::uuid=any(seen)),'No duplicate across complete traversal';
   seen:=array_append(seen,(item->>'id')::uuid);
  end loop;
  exit when page->'next_key'='null'::jsonb;
  key:=page->'next_key';
  page:=dvc_games_browse(org,anchor,null,null,true,true,'',null,(key->>'bucket')::int,(key->>'starts_at')::timestamptz,(key->>'id')::uuid);
 end loop;
 assert cardinality(seen)=28,'No skipped public games including history';
 assert seen[27]=cancelled and seen[28]=historical,'Historical bucket newest first after upcoming';
 page:=dvc_games_browse(org,anchor,null,venue,true,true,'test CITY');
 assert jsonb_array_length(page->'games')=12,'Search case insensitive';
 page:=dvc_games_browse(org,anchor,null,venue,true,true,'test city','setter');
 assert jsonb_array_length(page->'games')=0,'Full position filtered before limit';
 page:=dvc_games_browse(org,anchor,'2026-11-05',venue,false,false,'','open');
 assert jsonb_array_length(page->'games')=12,'Manila start-date and available position';
 page:=dvc_games_browse(org,anchor,'2026-11-04');
 assert jsonb_array_length(page->'games')=1,'Date filter keeps only ongoing start date';
 page:=dvc_games_browse(org,anchor,'2026-11-03',null,true,false);
 assert (page->'games'->0->>'id')::uuid=historical,'Include completed finds ended published history';
 page:=dvc_games_browse(org,anchor,'2026-11-06',null,false,true);
 assert (page->'games'->0->>'id')::uuid=cancelled,'Cancelled checkbox independent of clock';
 selected:=dvc_selected_games(org,array[ids[1],historical,cancelled,draft,foreign_game]);
 assert jsonb_array_length(selected->'games')=3,'Selected snapshots ignore date and lifecycle filter';
 assert jsonb_array_length(selected->'missing_ids')=2,'Absent/draft/foreign indistinguishable missing IDs';
 item:=dvc_public_game(org,ids[1]);
 assert item->>'venue_id'=venue::text,'Stable venue ID';
 assert (item->'positions'->0->>'price')::int=20000,'Effective price';
 assert not (item ?| array['organization_id','contact','receipts','players','created_at']),'Explicit public serializer';
 assert dvc_public_game(org,draft) is null and dvc_public_game(org,foreign_game) is null,'Helper also enforces privacy';
 assert jsonb_array_length(dvc_game_venues(org)->'venues')=1,'Include disabled referenced venue, omit draft-only venue';
 assert (select count(*)=3 from jsonb_object_keys(dvc_game_venues(org)->'venues'->0)),'Venue fields minimal';
 assert not has_function_privilege('anon','public.dvc_games_browse(uuid,timestamptz,date,uuid,boolean,boolean,text,text,integer,timestamptz,uuid)','execute'),'Anon cannot call service RPC';
 assert not has_function_privilege('authenticated','public.dvc_selected_games(uuid,uuid[])','execute'),'Authenticated cannot bypass server';
 assert has_function_privilege('service_role','public.dvc_game_venues(uuid,uuid)','execute'),'Service can call public venue read';
end $test$;
do $venues$
declare org uuid:=gen_random_uuid(); v uuid; n integer; page jsonb; cursor_id uuid; seen uuid[]:='{}'; item jsonb;
begin
 insert into organizations(id,name) values(org,'Venue pagination rollback fixture');
 for n in 1..205 loop
  v:=gen_random_uuid();
  insert into venues(id,organization_id,name,city) values(v,org,'Paginated court '||n,'Test');
  insert into games(organization_id,venue_id,venue,city,starts_at,ends_at,status,team_price)
  values(org,v,'Paginated court '||n,'Test',now()+interval '1 day',now()+interval '1 day 2 hours','published',120000);
 end loop;
 loop
  page:=dvc_game_venues(org,cursor_id);
  assert jsonb_array_length(page->'venues')<=100,'Venue page bound';
  for item in select value from jsonb_array_elements(page->'venues') loop
   assert not ((item->>'id')::uuid=any(seen)),'No duplicate venue across pages';
   seen:=array_append(seen,(item->>'id')::uuid);
  end loop;
  exit when page->>'next_cursor' is null;
  cursor_id:=(page->>'next_cursor')::uuid;
 end loop;
 assert cardinality(seen)=205,'Every venue reachable without silent truncation';
end $venues$;
rollback;
