-- Run as owner on a fresh isolated database after m5_lineup_operations.sql.
-- Exercise the private mutation directly and the public wrapper's denial separately.
begin;
do $test$
declare
  org uuid := gen_random_uuid();
  game uuid := gen_random_uuid();
  team_booking uuid := gen_random_uuid();
  held_booking uuid := gen_random_uuid();
  core_entry uuid := gen_random_uuid();
  extra_entry uuid := gen_random_uuid();
  unnamed_entry uuid := gen_random_uuid();
  unnamed_booking uuid := gen_random_uuid();
  move_core jsonb;
  extra_edit jsonb;
  denied boolean;
begin
  insert into organizations(id,name) values(org,'M5 Lineup QA');
  insert into games(id,organization_id,venue,city,starts_at,ends_at,status,team_count,team_price)
  values(game,org,'QA Court','TEST',now()+interval '1 day',now()+interval '1 day 2 hours','published',3,150000);
  insert into bookings(id,organization_id,game_id,guest_hash,kind,captain_name,contact,amount,status,expires_at)
  values
    (team_booking,org,game,repeat('a',64),'team','QA Captain','qa@example.test',150000,'reserved',now()),
    (held_booking,org,game,repeat('b',64),'individual','QA Hold','qa@example.test',25000,'holding',now()+interval '10 minutes');
  insert into roster_entries(id,booking_id,position,team,is_registrant,has_details)
  values
    (core_entry,team_booking,'open',1,true,false),
    (extra_entry,team_booking,'open',null,false,false);
  insert into roster_entries(booking_id,position,team,has_details)
  values (team_booking,'open',1,false), (team_booking,'middle',1,false),
         (team_booking,'middle',1,false), (team_booking,'opposite',1,false),
         (team_booking,'setter',1,false), (held_booking,'middle',2,false);
  move_core := jsonb_build_object('id',core_entry,'expected_team',1,'expected_version',0,'team',2,'name','');

  assert not has_function_privilege('service_role','public.dvc_update_extended_lineup(uuid,jsonb)','execute');
  denied := false;
  begin
    perform dvc_admin(org,null,'roster.update',move_core,gen_random_uuid());
  exception when raise_exception then denied := sqlerrm = 'Access denied';
  end;
  assert denied, 'An actor without staff privileges must be denied';
  assert dvc_update_extended_lineup(gen_random_uuid(),move_core) is null, 'Another organization cannot update the lineup';

  denied := false;
  begin
    perform dvc_update_extended_lineup(org,move_core);
  exception when raise_exception then denied := sqlerrm = 'Choose an empty team for this registration';
  end;
  assert denied, 'A live hold occupies the destination';
  assert (select count(*)=6 from roster_entries where booking_id=team_booking and team=1 and version=0);

  update bookings set expires_at=now()-interval '1 minute' where id=held_booking;
  assert dvc_update_extended_lineup(org,move_core)=core_entry;
  assert (select count(*)=6 from roster_entries where booking_id=team_booking and team=2 and version=1);
  assert (select team is null and version=0 and name is null from roster_entries where id=extra_entry);
  assert (select captain_name='QA Captain' from bookings where id=team_booking);

  denied := false;
  begin
    perform dvc_update_extended_lineup(org,move_core);
  exception when raise_exception then denied := sqlerrm = 'Lineup changed. Refresh and try again';
  end;
  assert denied, 'A stale core move is rejected';

  extra_edit := jsonb_build_object('id',extra_entry,'expected_team',null,'expected_version',0,'team',null,'name','QA Extra',
    'profile',jsonb_build_object('level','intermediate','gender','prefer_not_to_say','birth_date','2000-01-01','first_timer',false));
  assert dvc_update_extended_lineup(org,extra_edit)=extra_entry;
  assert (select name='QA Extra' and team is null and version=1 and has_details and birth_date=date '2000-01-01'
          from roster_entries where id=extra_entry);
  assert (select count(*)=6 from roster_entries where booking_id=team_booking and team=2 and version=1);

  denied := false;
  begin
    perform dvc_update_extended_lineup(org,extra_edit||'{"team":3,"expected_version":1}'::jsonb);
  exception when raise_exception then denied := sqlerrm = 'Additional team players stay unassigned';
  end;
  assert denied, 'Editing an extra does not allow assignment';

  insert into bookings(id,organization_id,game_id,guest_hash,kind,captain_name,contact,amount,status,manual)
  values(unnamed_booking,org,game,repeat('c',64),'individual','QA Organizer','qa@example.test',25000,'reserved',true);
  insert into roster_entries(id,booking_id,position,is_registrant,has_details)
  values(unnamed_entry,unnamed_booking,'setter',true,false);
  assert dvc_update_extended_lineup(org,jsonb_build_object('id',unnamed_entry,'expected_team',null,
    'expected_version',0,'team',3,'name','')) = unnamed_entry;
  assert (select team=3 and name is null and not has_details from roster_entries where id=unnamed_entry);
  assert (select captain_name='QA Organizer' from bookings where id=unnamed_booking);
end $test$;
rollback;
