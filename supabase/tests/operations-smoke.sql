-- Dedicated development project only. No authentication identity fixtures.
begin;
do $test$
declare org uuid:='00000000-0000-0000-0000-000000000001'; g uuid:=gen_random_uuid(); b uuid; b2 uuid; r jsonb; denied boolean;
begin
 insert into games(id,organization_id,venue,city,starts_at,ends_at,status,team_price,team_count) values(g,org,'Operations rollback fixture','TEST',now()+interval '1 day',now()+interval '2 days','published',120000,2);
 insert into game_positions(game_id,position,capacity,price) select g,p,case when p in ('open','middle') then 4 else 2 end,20000 from unnest(array['open','opposite','middle','setter']) p;
 r:=dvc_hold(org,null,repeat('a',64),jsonb_build_object('level','intermediate','age',25,'gender','prefer_not_to_say','game_id',g,'kind','team','position','setter','name','Registrant','contact','test@example.invalid','teammates','[{"position":"open","name":"Named teammate","level":"intermediate","age":25,"gender":"female"}]'::jsonb),gen_random_uuid());b:=(r->>'id')::uuid;
 assert (select count(*)=6 from roster_entries where booking_id=b),'six entries';
 assert (select count(*)=1 from roster_entries where booking_id=b and is_registrant and name='Registrant' and position='setter' and version=0),'exact registrant marker and initial version';
 assert (select count(distinct team)=1 and min(team)=1 from roster_entries where booking_id=b),'team occupies one whole team';
 assert (select count(*)=1 from roster_entries where booking_id=b and name='Named teammate' and position='open'),'optional teammate name';
 assert (select count(*)=4 from roster_entries where booking_id=b and name is null),'unnamed placeholders';
 assert dvc_free_team(g)=2,'next team slot';
 update bookings set expires_at=now()-interval '1 minute' where id=b;
 assert dvc_free_team(g)=1,'expiry releases team';
 r:=dvc_hold(org,null,repeat('b',64),jsonb_build_object('level','intermediate','age',25,'gender','prefer_not_to_say','game_id',g,'kind','individual','position','open','name','Individual one','contact','test@example.invalid'),gen_random_uuid());b:=(r->>'id')::uuid;
 update roster_entries set team=1 where booking_id=b;
 r:=dvc_hold(org,null,repeat('c',64),jsonb_build_object('level','intermediate','age',25,'gender','prefer_not_to_say','game_id',g,'kind','individual','position','open','name','Individual two','contact','test@example.invalid'),gen_random_uuid());b2:=(r->>'id')::uuid;
 update roster_entries set team=2 where booking_id=b2;
 denied:=false;
 begin perform dvc_hold(org,null,repeat('d',64),jsonb_build_object('level','intermediate','age',25,'gender','prefer_not_to_say','game_id',g,'kind','team','position','setter','name','Team','contact','test@example.invalid'),gen_random_uuid()); exception when raise_exception then denied:=true;end;
 assert denied,'fragmented teams reject whole registration despite position counts';
 assert (select count(*)=3 from bookings where game_id=g),'rejection leaves no partial booking';
 denied:=false;
 begin perform dvc_hold(org,null,repeat('e',64),jsonb_build_object('level','intermediate','age',25,'gender','prefer_not_to_say','game_id',g,'kind','team','position','setter','name','Team','contact','test@example.invalid','teammates','[{"position":"setter","name":"Extra setter","level":"advanced","age":25,"gender":"male"}]'::jsonb),gen_random_uuid()); exception when raise_exception then denied:=true;end;
 assert denied,'composition enforced in SQL';
 assert not has_table_privilege('authenticated','venues','UPDATE'),'venue direct write denied';
 assert not has_table_privilege('anon','game_facilitators','SELECT'),'staff identity direct reads denied';
 assert not has_function_privilege('anon','dvc_free_team(uuid)','EXECUTE'),'helper service-only';
 assert dvc_role(org,null)='player','unlisted null role';
end $test$;
select 'PASS: optional teammate names, six entries, whole-team slots, expiry, fragmented-team denial, rollback atomicity, SQL composition validation and new private grants' as result;
rollback;
