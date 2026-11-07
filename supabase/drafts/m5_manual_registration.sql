-- DRAFT: apply after unified_registration.sql.
-- Standalone manual reservations use the same review and game locks as checkout.
begin;

alter table public.bookings drop constraint bookings_organizer_participation;
alter table public.bookings add constraint bookings_organizer_participation
  check (organizer_plays or kind = 'team' or checkout_id is not null or manual);

create table public.manual_registration_requests (
  organization_id uuid not null references public.organizations(id),
  staff_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  fingerprint text not null,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  primary key (organization_id, staff_id, request_id)
);
alter table public.manual_registration_requests enable row level security;
revoke all on public.manual_registration_requests from public, anon, authenticated, service_role;

create function public.dvc_manual_register(p_org uuid, p_user uuid, p_data jsonb, p_ref uuid)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  intent_id uuid := (p_data->>'request_id')::uuid;
  intent_fingerprint text := encode(sha256(convert_to(p_data::text, 'UTF8')), 'hex');
  prior manual_registration_requests;
  organizer jsonb := p_data->'organizer';
  selection jsonb;
  game_id uuid;
  reviewed jsonb;
  player jsonb;
  profile jsonb;
  booking_id uuid;
  team_slot integer;
  assigned_team integer;
  core_counts jsonb := '{}'::jsonb;
  position text;
  count_assigned integer;
begin
  if coalesce(dvc_role(p_org, p_user), 'player') not in ('developer', 'admin', 'coordinator') then
    raise exception 'Access denied';
  end if;
  if intent_id is null or jsonb_typeof(p_data->'games') is distinct from 'array'
    or jsonb_array_length(p_data->'games') <> 1 then
    raise exception 'Choose exactly one game for manual registration';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':manual:' || p_user::text || ':' || intent_id::text, 0));
  select r.* into prior from manual_registration_requests r
  where r.organization_id = p_org and r.staff_id = p_user and r.request_id = intent_id;
  if found then
    if prior.fingerprint is distinct from intent_fingerprint then
      raise exception 'This request already saved a different registration. Check the game roster';
    end if;
    return prior.booking_id;
  end if;

  selection := p_data->'games'->0;
  game_id := (selection->>'game_id')::uuid;
  perform 1 from games g where g.id = game_id and g.organization_id = p_org for update;
  if not found then raise exception 'Game not found'; end if;
  reviewed := dvc_checkout_review(p_org, p_data)->'games'->0;
  if selection->'expected_amount' is distinct from reviewed->'amount'
    or selection->'expected_quote'->'position_prices' is distinct from reviewed->'quote'->'position_prices'
    or selection->'expected_quote'->'team_price' is distinct from reviewed->'quote'->'team_price' then
    raise exception 'Game pricing changed. Refresh availability to see the current price';
  end if;
  if selection->'expected_quote' is distinct from reviewed->'quote' then
    raise exception 'Game schedule changed. Refresh availability to see the current schedule';
  end if;
  if reviewed->>'kind' = 'team' then
    team_slot := dvc_free_team(game_id);
    if team_slot is null then raise exception 'No whole team slot is available'; end if;
  end if;

  -- Staff creates the booking on behalf of the organizer. The staff account
  -- must not become the player owner or gain it in My bookings.
  insert into bookings (
    organization_id, game_id, guest_hash, kind, captain_name, contact, amount,
    organizer_plays, organizer_email, status, payment_status, manual, quote_snapshot
  ) values (
    p_org, game_id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
    reviewed->>'kind', trim(organizer->>'name'), trim(organizer->>'contact'), (reviewed->>'amount')::integer,
    (reviewed->>'organizer_plays')::boolean, dvc_optional_email(organizer->>'email'),
    'reserved', 'pending', true, reviewed->'quote'
  ) returning id into booking_id;

  for player in select value from jsonb_array_elements(reviewed->'players') loop
    position := player->>'position';
    assigned_team := null;
    if team_slot is not null then
      count_assigned := coalesce((core_counts->>position)::integer, 0);
      if count_assigned < (case when position in ('open', 'middle') then 2 else 1 end) then
        assigned_team := team_slot;
        core_counts := jsonb_set(core_counts, array[position], to_jsonb(count_assigned + 1));
      end if;
    end if;
    profile := case when (player->>'has_details')::boolean
      then dvc_player_profile(player, ((reviewed->>'starts_at')::timestamptz at time zone 'Asia/Manila')::date)
      else '{}'::jsonb end;
    insert into roster_entries (
      booking_id, position, name, team, is_registrant, has_details, level, gender, age, birth_date, first_timer, email
    ) values (
      booking_id, position, player->>'name', assigned_team, (player->>'is_registrant')::boolean,
      (player->>'has_details')::boolean, profile->>'level', profile->>'gender',
      (profile->>'age')::integer, (profile->>'birth_date')::date, (profile->>'first_timer')::boolean,
      case when not (player->>'has_details')::boolean then null
        when (player->>'is_registrant')::boolean then dvc_optional_email(organizer->>'email')
        else dvc_optional_email(player->>'email') end
    );
  end loop;

  insert into manual_registration_requests (organization_id, staff_id, request_id, fingerprint, booking_id)
  values (p_org, p_user, intent_id, intent_fingerprint, booking_id);
  perform dvc_event(p_org, p_user, 'manual.register', booking_id, p_ref);
  return booking_id;
end;
$$;
revoke all on function public.dvc_manual_register(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.dvc_manual_register(uuid, uuid, jsonb, uuid) to service_role;
commit;
