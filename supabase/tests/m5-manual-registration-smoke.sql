-- Run as database owner on an approved isolated database with
-- psql --set=m5_staff=<verified synthetic email account UUID>.
-- Fixture organization, whitelist entry, games and bookings are rolled back.
begin;
select set_config('dvc.qa_manual_staff_id', :'m5_staff', true);

do $test$
declare
  org uuid := gen_random_uuid();
  staff uuid := current_setting('dvc.qa_manual_staff_id')::uuid;
  court uuid := gen_random_uuid();
  player_email text;
  organizer jsonb := '{"name":"QA Organizer","contact":"qa@example.test","email":"qa@example.test"}';
  group_players jsonb := '[{"position":"open","has_details":false,"is_registrant":false},{"position":"open","has_details":false,"is_registrant":false}]';
  team_players jsonb;
  intent jsonb;
  quote jsonb;
  group_booking uuid;
  team_booking uuid;
  denied boolean;
begin
  select u.email into player_email from auth.users u where id = staff and email_confirmed_at is not null;
  assert player_email is not null, 'Use a real verified synthetic account';
  insert into organizations(id, name) values (org, 'M5 manual QA');
  insert into staff_email_whitelist(organization_id,email,role,enabled) values(org,lower(player_email),'coordinator',true);
  assert dvc_role(org, staff) = 'coordinator', 'Staff fixture must resolve through current email whitelist';
  insert into games(id,organization_id,venue,city,starts_at,ends_at,status,team_count,team_price,team_discount_price)
    values(court,org,'Manual QA Court','TEST',now()+interval '4 days',now()+interval '4 days 2 hours','published',4,165000,150000);
  insert into game_positions(game_id,position,capacity,price,discount_price)
    select court, pos, 8, 30000, 25000 from unnest(array['open','opposite','middle','setter']) as positions(pos);

  intent := jsonb_build_object('request_id',gen_random_uuid(),'organizer',organizer,
    'games',jsonb_build_array(jsonb_build_object('game_id',court,'kind','group','organizer_plays',false,'players',group_players)));
  quote := dvc_checkout_review(org,intent)->'games'->0->'quote';
  intent := jsonb_set(jsonb_set(intent,'{games,0,expected_amount}','50000'),'{games,0,expected_quote}',quote);
  denied := false;
  begin
    perform dvc_manual_register(org,null,intent,gen_random_uuid());
  exception when raise_exception then denied := sqlerrm = 'Access denied';
  end;
  assert denied, 'A nonstaff actor cannot manually reserve a game';
  assert not has_function_privilege('authenticated','public.dvc_manual_register(uuid,uuid,jsonb,uuid)','execute');

  denied := false;
  begin
    perform dvc_manual_register(org,staff,jsonb_set(intent,'{games,0,expected_amount}','60000'),gen_random_uuid());
  exception when raise_exception then denied := sqlerrm like 'Game pricing changed%';
  end;
  assert denied and not exists(select 1 from bookings where game_id=court), 'Price conflicts leave no reservation';

  update games set venue='Rescheduled QA Court' where id=court;
  denied := false;
  begin
    perform dvc_manual_register(org,staff,intent,gen_random_uuid());
  exception when raise_exception then denied := sqlerrm like 'Game schedule changed%';
  end;
  assert denied and not exists(select 1 from bookings where game_id=court), 'Schedule conflict leaves no reservation even at the same price';
  update games set venue='Manual QA Court' where id=court;

  group_booking := dvc_manual_register(org,staff,intent,gen_random_uuid());
  assert dvc_manual_register(org,staff,intent,gen_random_uuid()) = group_booking, 'An exact retry returns the same booking';
  assert (select count(*)=1 from bookings where game_id=court), 'No duplicate booking on retry';
  assert (select status='reserved' and payment_status='pending' and manual and checkout_id is null
    and user_id is null and amount=50000 and not organizer_plays from bookings where id=group_booking);
  assert (select count(*)=2 and bool_and(name is null and not has_details)
    from roster_entries where booking_id=group_booking), 'An organizer-only group can reserve unnamed positions';
  denied := false;
  begin
    perform dvc_manual_register(org,staff,jsonb_set(intent,'{games,0,expected_amount}','60000'),gen_random_uuid());
  exception when raise_exception then denied := sqlerrm like 'This request already saved%';
  end;
  assert denied, 'A changed request cannot reuse the same committed request ID';

  select jsonb_agg(jsonb_build_object('position',pos,'has_details',false,'is_registrant',false) order by idx)
    into team_players from unnest(array['open','open','opposite','middle','middle','setter','open']) with ordinality positions(pos,idx);
  intent := jsonb_build_object('request_id',gen_random_uuid(),'organizer',organizer,
    'games',jsonb_build_array(jsonb_build_object('game_id',court,'kind','team','organizer_plays',false,'players',team_players)));
  quote := dvc_checkout_review(org,intent)->'games'->0->'quote';
  intent := jsonb_set(jsonb_set(intent,'{games,0,expected_amount}','150000'),'{games,0,expected_quote}',quote);
  update game_positions set capacity=4 where game_id=court and position='open';
  denied := false;
  begin
    perform dvc_manual_register(org,staff,intent,gen_random_uuid());
  exception when raise_exception then denied := sqlerrm like 'A selected position is no longer available%';
  end;
  assert denied and (select count(*)=1 from bookings where game_id=court), 'Capacity conflict leaves no partial reservation';
  update game_positions set capacity=8 where game_id=court and position='open';
  team_booking := dvc_manual_register(org,staff,intent,gen_random_uuid());
  assert (select count(*)=7 and count(team)=6 and count(distinct team)=1
    from roster_entries where booking_id=team_booking), 'A seven-player team assigns exactly its six-person core';
  assert (select amount=150000 and status='reserved' and payment_status='pending'
    from bookings where id=team_booking), 'A qualifying extended team uses the effective team price';
end $test$;
rollback;
