-- Apply after unified_registration.sql. Adds one guest organizer outbox row per
-- confirmed checkout. Existing receipts, legacy mail and bookings stay intact.
begin;

create function public.dvc_enqueue_guest_checkout_confirmation() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.user_id is not null or new.organizer_email is null
    or not exists(select 1 from checkout_receipts where checkout_id=new.id) then return new; end if;
 insert into booking_confirmation_outbox(organization_id,booking_id,recipient,payload)
 select new.organization_id,b.id,lower(trim(new.organizer_email)),
  jsonb_build_object('checkout_reference',new.id,'status','reserved','time_zone','Asia/Manila',
   'games',(select jsonb_agg(jsonb_build_object('id',g.id,'venue',g.venue,'starts_at',g.starts_at,'ends_at',g.ends_at) order by g.starts_at,g.id)
    from bookings child join games g on g.id=child.game_id where child.checkout_id=new.id))
 from bookings b where b.checkout_id=new.id order by b.id limit 1
 on conflict (booking_id,event,recipient) do nothing;
 return new;
end $$;

create trigger dvc_guest_checkout_confirmation after update of status on public.checkouts
 for each row when (new.status='reserved' and old.status is distinct from new.status)
 execute function public.dvc_enqueue_guest_checkout_confirmation();

-- The service validates the signed email link before calling this RPC. The DB
-- independently verifies the current account email and serializes ownership.
create function public.dvc_open_guest_checkout(p_org uuid,p_message uuid,p_user uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c checkouts; message booking_confirmation_outbox; account_email text;
 guest_owner text; account_owner text; first_game uuid;
begin
 select * into message from booking_confirmation_outbox
  where id=p_message and organization_id=p_org and payload ? 'checkout_reference';
 if not found then return null; end if;
 select * into c from checkouts where id=(message.payload->>'checkout_reference')::uuid and organization_id=p_org;
 if not found or c.status<>'reserved' or lower(trim(c.organizer_email)) is distinct from message.recipient then return null; end if;
 if p_user is null then
  if c.user_id is not null then return null; end if;
  return jsonb_build_object('outcome','guest','games',message.payload->'games');
 end if;

 select lower(trim(email)) into account_email from auth.users
  where id=p_user and email_confirmed_at is not null;
 if account_email is distinct from message.recipient then return jsonb_build_object('outcome','email_mismatch'); end if;
 if c.user_id=p_user then return jsonb_build_object('outcome','linked'); end if;
 if c.user_id is not null then return null; end if;

 guest_owner:=c.owner_key;
 account_owner:='user:'||p_user::text;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||least(guest_owner,account_owner),0));
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||greatest(guest_owner,account_owner),0));
 select * into c from checkouts where id=c.id and organization_id=p_org for update;
 if not found or c.status<>'reserved' then return null; end if;
 if c.user_id=p_user then return jsonb_build_object('outcome','linked'); end if;
 if c.user_id is not null or c.owner_key is distinct from guest_owner then return null; end if;
 if exists(select 1 from checkouts where organization_id=p_org and owner_key=account_owner and request_id=c.request_id)
    or exists(select 1 from checkout_declined_intents where organization_id=p_org and owner_key=account_owner and request_id=c.request_id)
    or exists(select 1 from bookings b where b.checkout_id=c.id and
      (b.organization_id<>p_org or b.user_id is not null or b.guest_hash is distinct from c.guest_hash))
 then return jsonb_build_object('outcome','conflict'); end if;
 select game_id into first_game from bookings where checkout_id=c.id order by id limit 1;
 if not found then return null; end if;

 -- Fence retries from the old guest browser before moving the original IDs.
 insert into checkout_declined_intents(organization_id,owner_key,request_id,request_fingerprint,conflicts)
 values(p_org,guest_owner,c.request_id,c.request_fingerprint,
  jsonb_build_array(jsonb_build_object('game_id',first_game,'code','SELECTION_UNAVAILABLE')));
 update bookings set user_id=p_user,guest_hash=null where checkout_id=c.id;
 update checkouts set user_id=p_user,guest_hash=null where id=c.id;
 return jsonb_build_object('outcome','linked');
end $$;

revoke all on function public.dvc_enqueue_guest_checkout_confirmation(),public.dvc_open_guest_checkout(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.dvc_open_guest_checkout(uuid,uuid,uuid) to service_role;
commit;
