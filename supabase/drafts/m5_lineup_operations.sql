-- Apply after game_operations_transfers.sql. No data backfill.
-- To roll back, drop the new dvc_admin, rename dvc_admin_before_m5_lineup
-- back to dvc_admin, restore its service_role grant, then drop the helper.
-- Preserve completed lineup edits when rolling back.
begin;

create function public.dvc_update_extended_lineup(p_org uuid, p_data jsonb)
returns uuid language plpgsql set search_path = public, pg_temp as $$
declare
  entry_id uuid := (p_data->>'id')::uuid;
  booking_id uuid;
  game_id uuid;
  game public.games;
  booking public.bookings;
  player public.roster_entries;
  destination int := (p_data->>'team')::int;
  player_name text := nullif(trim(p_data->>'name'), '');
  profile jsonb;
  position_capacity integer;
begin
  select b.id, b.game_id into booking_id, game_id
  from public.roster_entries r
  join public.bookings b on b.id = r.booking_id
  where r.id = entry_id and b.organization_id = p_org and b.status = 'reserved'
    and (
      (b.kind = 'team' and exists (select 1 from public.roster_entries e where e.booking_id = b.id offset 6))
      or (r.is_registrant and r.has_details = false and r.name is null)
    );
  if not found then return null; end if;

  -- Match checkout and transfer lock ordering. The booking may have moved
  -- while waiting for the original game lock.
  select g.* into game from public.games g
  where g.id = game_id and g.organization_id = p_org for update;
  if not found then raise exception 'Roster changed. Refresh and try again'; end if;

  select b.* into booking from public.bookings b
  where b.id = booking_id and b.game_id = game.id and b.organization_id = p_org
    and b.status = 'reserved' for update;
  if not found then raise exception 'Roster changed. Refresh and try again'; end if;

  select r.* into player from public.roster_entries r
  where r.id = entry_id and r.booking_id = booking.id for update;
  if not found or player.version is distinct from (p_data->>'expected_version')::int
    or (p_data ? 'expected_team' and player.team is distinct from (p_data->>'expected_team')::int)
  then raise exception 'Lineup changed. Refresh and try again'; end if;

  if char_length(player_name) > 100 then raise exception 'Check player name'; end if;
  if player.is_registrant and player.name is not null and player_name is null then
    raise exception 'Registrant name is required';
  end if;
  if player_name is not null and p_data ? 'profile' then
    profile := public.dvc_player_profile(
      p_data->'profile', (game.starts_at at time zone 'Asia/Manila')::date,
      player.name is null or player.first_timer is not null
    );
  elsif player_name is not null and player.name is null then
    raise exception 'Add player details when naming a placeholder';
  end if;

  if destination is distinct from player.team then
    if destination is not null and (destination < 1 or destination > game.team_count) then
      raise exception 'Choose an existing team';
    end if;
    if booking.kind = 'team' then
      if player.team is null then raise exception 'Additional team players stay unassigned'; end if;
      if destination is null then raise exception 'A team registration must occupy a whole team'; end if;

      -- The existing reservation/transfer writers assign two open, two middle,
      -- one opposite and one setter to a single team. Refuse malformed cores
      -- rather than moving other rows or making a partial assignment.
      if exists (
        select 1 from (values ('open', 2), ('middle', 2), ('opposite', 1), ('setter', 1)) as slot(position, required)
        where (select count(*) from public.roster_entries r
          where r.booking_id = booking.id and r.team = player.team and r.position = slot.position) <> slot.required
      ) then raise exception 'Team lineup changed. Refresh and try again'; end if;

      if exists (
        select 1 from public.roster_entries r
        join public.bookings b on b.id = r.booking_id
        where b.game_id = game.id and r.team = destination
          and (b.status = 'reserved' or (b.status = 'holding' and b.expires_at > clock_timestamp()))
      ) then raise exception 'Choose an empty team for this registration'; end if;

      update public.roster_entries r set team = destination, version = r.version + 1
      where r.booking_id = booking.id and r.team = player.team and r.id <> player.id;
    elsif destination is not null then
      position_capacity := case when player.position in ('open', 'middle') then 2 else 1 end;
      if (select count(*) from public.roster_entries r
        join public.bookings b on b.id = r.booking_id
        where b.game_id = game.id and r.team = destination and r.position = player.position and r.id <> player.id
          and (b.status = 'reserved' or (b.status = 'holding' and b.expires_at > clock_timestamp()))
      ) >= position_capacity then raise exception 'That team position is full'; end if;
    end if;
  end if;

  -- Keep the current profile on a move, and clear it when a name is removed.
  profile := case when player_name is not null then coalesce(profile, to_jsonb(player))
                  else '{}'::jsonb end;
  update public.roster_entries r
  set name = player_name, team = destination, version = r.version + 1,
      has_details = case when r.has_details is not null then player_name is not null end,
      level = profile->>'level',
      gender = profile->>'gender',
      age = (profile->>'age')::int,
      birth_date = (profile->>'birth_date')::date,
      first_timer = (profile->>'first_timer')::boolean,
      email = case when player_name is not null then r.email end
  where r.id = player.id;

  if player.is_registrant and player_name is not null and player_name is distinct from player.name then
    update public.bookings b set captain_name = player_name where b.id = booking.id;
  end if;

  return entry_id;
end $$;

revoke all on function public.dvc_update_extended_lineup(uuid,jsonb) from public,anon,authenticated,service_role;

alter function public.dvc_admin(uuid,uuid,text,jsonb,uuid) rename to dvc_admin_before_m5_lineup;
revoke all on function public.dvc_admin_before_m5_lineup(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;

create function public.dvc_admin(p_org uuid,p_user uuid,p_action text,p_data jsonb,p_ref uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  entry_id uuid;
  manual_booking public.bookings;
  updated_contact text;
  updated_email text;
begin
  if p_action = 'roster.update' then
    if coalesce(public.dvc_role(p_org,p_user),'player') not in ('developer','admin','coordinator') then
      raise exception 'Access denied';
    end if;
    entry_id := public.dvc_update_extended_lineup(p_org,p_data);
    if entry_id is not null then
      perform public.dvc_event(p_org,p_user,p_action,entry_id,p_ref);
      return entry_id;
    end if;
  end if;

  if p_action in ('booking.details', 'receipt.approve', 'receipt.reject') then
    select b.* into manual_booking
    from public.bookings b
    where b.id = (p_data->>'id')::uuid and b.organization_id = p_org
      and b.manual and b.checkout_id is null;

    if found and p_action = 'booking.details' then
      if coalesce(public.dvc_role(p_org,p_user),'player') not in ('developer','admin','coordinator') then
        raise exception 'Access denied';
      end if;
      perform 1 from public.games where id = manual_booking.game_id for update;
      select b.* into manual_booking from public.bookings b
      where b.id = manual_booking.id and b.game_id = manual_booking.game_id for update;
      if not found then raise exception 'Registration moved. Refresh and try again'; end if;

      updated_contact := trim(p_data->>'contact');
      updated_email := case
        when updated_contact = manual_booking.contact then manual_booking.organizer_email
        when updated_contact ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then lower(updated_contact)
      end;
      update public.bookings
      set captain_name = trim(p_data->>'name'), contact = updated_contact, organizer_email = updated_email
      where id = manual_booking.id;

      update public.roster_entries
      set name = trim(p_data->>'name'), version = version + 1,
          email = case when updated_contact is distinct from manual_booking.contact then updated_email else email end
      where booking_id = manual_booking.id and is_registrant and has_details is distinct from false;
      perform public.dvc_event(p_org,p_user,p_action,manual_booking.id,p_ref);
      return manual_booking.id;
    elsif found and manual_booking.kind = 'group' then
      -- Standalone groups use the legacy staff receipt workflow. The
      -- combined-checkout guard continues to protect linked bookings.
      return public.dvc_legacy_admin(p_org,p_user,p_action,p_data,p_ref);
    end if;
  end if;

  return public.dvc_admin_before_m5_lineup(p_org,p_user,p_action,p_data,p_ref);
end $$;

revoke all on function public.dvc_admin(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.dvc_admin(uuid,uuid,text,jsonb,uuid) to service_role;
commit;
