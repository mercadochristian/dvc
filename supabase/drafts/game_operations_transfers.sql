-- Apply after unified_registration.sql. Preserve the original checkout and
-- payment snapshot while moving one confirmed game booking.
begin;

create function public.dvc_transfer_reserved_booking(p_org uuid,p_booking uuid,p_target uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
 b bookings; target games; original_game uuid; original_checkout uuid;
 checkout_state text; destination_date date; destination_amount bigint; team_slot int;
 slot record;
begin
 select game_id,checkout_id into original_game,original_checkout
 from bookings where id=p_booking and organization_id=p_org;
 if not found then raise exception 'Booking not found'; end if;

 -- Same lock order as receipt finalization: games, checkout, then booking.
 perform 1 from games where organization_id=p_org and id in (original_game,p_target) order by id for update;
 if original_checkout is not null then
  select status into checkout_state from checkouts where id=original_checkout and organization_id=p_org for update;
  if checkout_state is distinct from 'reserved' then raise exception 'Only confirmed checkouts can transfer'; end if;
 end if;
 select * into b from bookings where id=p_booking and organization_id=p_org for update;
 if not found or b.game_id is distinct from original_game or b.checkout_id is distinct from original_checkout then
  raise exception 'Booking changed. Refresh and try again';
 end if;
 if b.status<>'reserved' then raise exception 'Only reserved bookings can transfer'; end if;

 select * into target from games
 where id=p_target and organization_id=p_org and status='published' and starts_at>clock_timestamp();
 if not found or target.id=b.game_id then raise exception 'Choose another upcoming game'; end if;
 destination_date:=(target.starts_at at time zone 'Asia/Manila')::date;
 if not exists(select 1 from roster_entries where booking_id=b.id) then raise exception 'Booking has no players to transfer'; end if;
 if exists(select 1 from roster_entries where booking_id=b.id and birth_date>destination_date) then
  raise exception 'Game date is before a player birthday';
 end if;

 destination_amount:=0;
 for slot in
  select r.position,count(*) as needed,gp.capacity,coalesce(gp.discount_price,gp.price) as price
  from roster_entries r left join game_positions gp on gp.game_id=target.id and gp.position=r.position
  where r.booking_id=b.id group by r.position,gp.capacity,gp.discount_price,gp.price
 loop
  if slot.capacity is null or slot.needed + (
   select count(*) from roster_entries re join bookings other on other.id=re.booking_id
   where other.game_id=target.id and re.position=slot.position
    and (other.status='reserved' or (other.status='holding' and other.expires_at>clock_timestamp()))
  )>slot.capacity then raise exception 'Destination game has insufficient positions'; end if;
  destination_amount:=destination_amount+slot.needed*slot.price;
 end loop;
 if b.kind='team' then
  destination_amount:=coalesce(target.team_discount_price,target.team_price);
  if exists (
   select 1 from (values ('open',2),('middle',2),('setter',1),('opposite',1)) as core(position,required)
   where (select count(*) from roster_entries re where re.booking_id=b.id and re.position=core.position)<core.required
  ) then raise exception 'Booking does not have a complete team'; end if;
  team_slot:=dvc_free_team(target.id);
  if team_slot is null then raise exception 'Destination game has no whole team slot'; end if;
 end if;
 if b.amount<>destination_amount then raise exception 'Destination game must have the same booking price'; end if;

 update bookings set game_id=target.id where id=b.id;
 with ranked as (
  select id,position,row_number() over(partition by position order by (team is not null) desc,id) as slot_number
  from roster_entries where booking_id=b.id
 )
 update roster_entries r set
  team=case when ranked.slot_number<=case when ranked.position in ('open','middle') then 2 else 1 end then team_slot else null end,
  age=case when r.birth_date is null then r.age else extract(year from age(destination_date,r.birth_date))::int end,
  version=r.version+1
 from ranked where r.id=ranked.id;
 return b.id;
end $$;

-- Retain the previous implementation and guards for all other staff actions.
alter function public.dvc_admin(uuid,uuid,text,jsonb,uuid) rename to dvc_admin_before_transfers;
revoke all on function public.dvc_admin_before_transfers(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.dvc_transfer_reserved_booking(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.dvc_admin(p_org uuid,p_user uuid,p_action text,p_data jsonb,p_ref uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare entity uuid;
begin
 if p_action is distinct from 'booking.transfer' then
  return dvc_admin_before_transfers(p_org,p_user,p_action,p_data,p_ref);
 end if;
 if coalesce(dvc_role(p_org,p_user),'player') not in ('developer','admin') then raise exception 'Access denied'; end if;
 entity:=dvc_transfer_reserved_booking(p_org,(p_data->>'id')::uuid,(p_data->>'game_id')::uuid);
 perform dvc_event(p_org,p_user,p_action,entity,p_ref);
 return entity;
end $$;
revoke all on function public.dvc_admin(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.dvc_admin(uuid,uuid,text,jsonb,uuid) to service_role;
commit;
