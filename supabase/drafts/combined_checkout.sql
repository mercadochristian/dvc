-- DRAFT M4. Apply after checkout_registration.sql on a verified isolated target.
-- Additive checkout records; legacy bookings/receipts/statuses are not backfilled.
begin;
create table public.checkouts (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations,
 user_id uuid references auth.users, guest_hash text,
 owner_key text generated always as (case when user_id is not null then 'user:'||user_id::text else 'guest:'||guest_hash end) stored,
 request_id uuid not null, request_fingerprint text not null check(request_fingerprint ~ '^[a-f0-9]{64}$'),
 organizer_name text not null, contact text not null, organizer_email text not null,
 amount bigint not null check(amount>=0), status text not null default 'holding' check(status in ('holding','reserved','cancelled')),
 payment_status text not null default 'pending' check(payment_status in ('pending','approved')),
 expires_at timestamptz not null, created_at timestamptz not null default clock_timestamp(),
 check((user_id is not null) <> (guest_hash is not null)), check(guest_hash is null or guest_hash ~ '^[a-f0-9]{64}$'),
 unique(organization_id,owner_key,request_id)
);
-- A proven no-hold response is durable too: an older delayed RPC using that
-- request key must never create a hold after the user has corrected selections.
create table public.checkout_declined_intents (
 organization_id uuid not null references public.organizations, owner_key text not null,
 request_id uuid not null, request_fingerprint text not null check(request_fingerprint ~ '^[a-f0-9]{64}$'),
 conflicts jsonb not null check(jsonb_typeof(conflicts)='array' and jsonb_array_length(conflicts)>0),
 created_at timestamptz not null default clock_timestamp(), primary key(organization_id,owner_key,request_id)
);
alter table public.bookings add column checkout_id uuid references public.checkouts, add column quote_snapshot jsonb;
alter table public.bookings drop constraint bookings_kind_check;
alter table public.bookings add constraint bookings_kind_check check(kind in ('individual','group','team'));
alter table public.bookings drop constraint bookings_organizer_participation;
alter table public.bookings add constraint bookings_organizer_participation check(organizer_plays or kind='team' or checkout_id is not null);
create index bookings_checkout on public.bookings(checkout_id) where checkout_id is not null;
create table public.checkout_receipt_uploads (
 id uuid primary key, checkout_id uuid not null references public.checkouts, method_id uuid not null references public.payment_methods,
 path text not null unique, state text not null default 'pending' check(state in ('pending','committed','discarded')),
 cleanup_after timestamptz not null default (clock_timestamp()+interval '2 minutes'), checked_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 check(path ~ ('^checkout-receipts/'||checkout_id::text||'/'||id::text||'\.(png|jpg|webp)$'))
);
create index checkout_uploads_checkout_state on public.checkout_receipt_uploads(checkout_id,state,cleanup_after);
create table public.checkout_receipts (
 id uuid primary key default gen_random_uuid(), checkout_id uuid not null unique references public.checkouts,
 upload_id uuid not null unique references public.checkout_receipt_uploads, method_id uuid not null references public.payment_methods,
 path text not null unique, submitted_at timestamptz not null default clock_timestamp(),
 check(path ~ ('^checkout-receipts/'||checkout_id::text||'/[a-f0-9-]{36}\.(png|jpg|webp)$'))
);
alter table public.checkouts enable row level security;
alter table public.checkout_declined_intents enable row level security;
alter table public.checkout_receipt_uploads enable row level security;
alter table public.checkout_receipts enable row level security;
revoke all on public.checkouts,public.checkout_declined_intents,public.checkout_receipt_uploads,public.checkout_receipts from public,anon,authenticated;
grant all on public.checkouts,public.checkout_declined_intents,public.checkout_receipt_uploads,public.checkout_receipts to service_role;

-- Volatile read-only quote queries receive a fresh statement snapshot after the
-- caller's game locks. Availability and expiry use the current wall clock.
alter function public.dvc_checkout_review(uuid,jsonb) volatile;
create or replace function public.dvc_free_team(p_game uuid) returns integer
language sql volatile security definer set search_path=public,pg_temp as $$
 select min(n) from games g cross join lateral generate_series(1,g.team_count) n where g.id=p_game
 and not exists(select 1 from roster_entries r join bookings b on b.id=r.booking_id where b.game_id=p_game and r.team=n and (b.status='reserved' or(b.status='holding' and b.expires_at>clock_timestamp())));
$$;
create function public.dvc_checkout_owned(p_org uuid,p_user uuid,p_guest text,p_checkout uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from checkouts c where c.id=p_checkout and c.organization_id=p_org and
  case when p_user is not null then c.user_id=p_user else c.user_id is null and c.guest_hash=p_guest end);
$$;
create function public.dvc_checkout_json(p_checkout uuid) returns jsonb
language sql volatile security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',c.id,'request_id',c.request_id,'status',case when c.status='holding' and c.expires_at<=clock_timestamp() then 'expired' else c.status end,
 'payment_status',c.payment_status,'expires_at',c.expires_at,'created_at',c.created_at,'amount',c.amount,
 'receipt',(select jsonb_build_object('id',r.id,'submitted_at',r.submitted_at) from checkout_receipts r where r.checkout_id=c.id),
 'bookings',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'game_id',b.game_id,'checkout_id',c.id,'kind',b.kind,'captain_name',b.captain_name,
  'amount',b.amount,'organizer_plays',b.organizer_plays,'status',case when b.status='holding' and b.expires_at<=clock_timestamp() then 'expired' else b.status end,
  'payment_status',b.payment_status,'expires_at',b.expires_at,'created_at',b.created_at,'venue',g.venue,'maps_url',v.maps_url,'starts_at',g.starts_at,'ends_at',g.ends_at,
  'entries',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from roster_entries e where e.booking_id=b.id),'[]')) order by g.starts_at,b.id)
 from bookings b join games g on g.id=b.game_id left join venues v on v.id=g.venue_id and v.organization_id=c.organization_id where b.checkout_id=c.id),'[]'))
 from checkouts c where c.id=p_checkout;
$$;
create function public.dvc_checkout_read(p_org uuid,p_user uuid,p_guest text,p_checkout uuid) returns jsonb
language sql volatile security definer set search_path=public,pg_temp as $$
 select dvc_checkout_json(p_checkout) where dvc_checkout_owned(p_org,p_user,p_guest,p_checkout);
$$;

create function public.dvc_checkout_hold(p_org uuid,p_user uuid,p_guest text,p_data jsonb,p_ref uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 c checkouts; fingerprint text; owner_value text; game_id uuid; selection jsonb; quoted jsonb; quotes jsonb:='[]';
 conflicts jsonb:='[]'; declined_conflicts jsonb; player jsonb; profile jsonb; booking_id uuid; team_slot integer; expires timestamptz; amount bigint:=0;
begin
 if p_user is null and (p_guest is null or p_guest !~ '^[a-f0-9]{64}$') then raise exception 'Review your games before continuing'; end if;
 if p_user is not null and p_guest is not null then raise exception 'Account checkout cannot use guest ownership'; end if;
 if jsonb_typeof(p_data->'games') is distinct from 'array' or jsonb_array_length(p_data->'games')=0 then raise exception 'Select at least one game'; end if;
 if p_data->>'request_id' is null then raise exception 'Check request ID'; end if;
 if (select count(distinct (value->>'game_id')::uuid) from jsonb_array_elements(p_data->'games'))<>jsonb_array_length(p_data->'games') then raise exception 'Select each game only once'; end if;
 owner_value:=case when p_user is not null then 'user:'||p_user::text else 'guest:'||p_guest end;
 fingerprint:=encode(sha256(convert_to(p_data::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||owner_value,0));
 select * into c from checkouts x where x.organization_id=p_org and x.owner_key=owner_value and x.request_id=(p_data->>'request_id')::uuid;
 if found then
  if c.request_fingerprint<>fingerprint then return jsonb_build_object('outcome','intent_mismatch','checkout',dvc_checkout_json(c.id)); end if;
  return jsonb_build_object('outcome','existing','checkout',dvc_checkout_json(c.id));
 end if;
 select i.conflicts into declined_conflicts from checkout_declined_intents i where i.organization_id=p_org and i.owner_key=owner_value and i.request_id=(p_data->>'request_id')::uuid;
 if found then return jsonb_build_object('outcome','selection_conflict','conflicts',declined_conflicts); end if;
 -- Every capacity writer locks games; stable ordering avoids cross-game deadlocks.
 for game_id in select distinct (value->>'game_id')::uuid from jsonb_array_elements(p_data->'games') order by 1 loop
  perform 1 from games where id=game_id and organization_id=p_org for update;
 end loop;
 -- All validation/consent conflicts below precede checkout, booking and profile writes.
 for selection in select value from jsonb_array_elements(p_data->'games') loop
  begin
   quoted:=dvc_checkout_review(p_org,jsonb_build_object('request_id',p_data->'request_id','organizer',p_data->'organizer','games',jsonb_build_array(selection)))->'games'->0;
  exception when raise_exception then
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('game_id',selection->'game_id','code','SELECTION_UNAVAILABLE')); continue;
  end;
  if selection->'expected_amount' is distinct from quoted->'amount'
   or selection->'expected_quote'->'position_prices' is distinct from quoted->'quote'->'position_prices'
   or selection->'expected_quote'->'team_price' is distinct from quoted->'quote'->'team_price' then
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('game_id',selection->'game_id','code','PRICE_CHANGED'));
  elsif ((selection->'expected_quote')-'position_prices'-'team_price') is distinct from ((quoted->'quote')-'position_prices'-'team_price') then
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('game_id',selection->'game_id','code','SCHEDULE_CHANGED'));
  end if;
  quotes:=quotes||jsonb_build_array(quoted); amount:=amount+(quoted->>'amount')::bigint;
 end loop;
 if jsonb_array_length(conflicts)>0 then
  insert into checkout_declined_intents(organization_id,owner_key,request_id,request_fingerprint,conflicts) values(p_org,owner_value,(p_data->>'request_id')::uuid,fingerprint,conflicts);
  return jsonb_build_object('outcome','selection_conflict','conflicts',conflicts);
 end if;
 expires:=clock_timestamp()+interval '10 minutes';
 insert into checkouts(organization_id,user_id,guest_hash,request_id,request_fingerprint,organizer_name,contact,organizer_email,amount,expires_at)
 values(p_org,p_user,p_guest,(p_data->>'request_id')::uuid,fingerprint,trim(p_data->'organizer'->>'name'),trim(p_data->'organizer'->>'contact'),dvc_optional_email(p_data->'organizer'->>'email'),amount,expires) returning * into c;
 for quoted in select value from jsonb_array_elements(quotes) loop
  game_id:=(quoted->>'game_id')::uuid;
  team_slot:=case when quoted->>'kind'='team' then dvc_free_team(game_id) else null end;
  if quoted->>'kind'='team' and team_slot is null then raise exception 'No whole team slot is available'; end if;
  insert into bookings(organization_id,game_id,user_id,guest_hash,kind,captain_name,contact,amount,organizer_plays,organizer_email,expires_at,checkout_id,quote_snapshot)
  values(p_org,game_id,p_user,p_guest,quoted->>'kind',c.organizer_name,c.contact,(quoted->>'amount')::int,(quoted->>'organizer_plays')::boolean,c.organizer_email,expires,c.id,quoted->'quote') returning id into booking_id;
  for player in select value from jsonb_array_elements(quoted->'players') loop
   profile:=case when player->>'name' is null then '{}'::jsonb else dvc_player_profile(player,((quoted->>'starts_at')::timestamptz at time zone 'Asia/Manila')::date) end;
   insert into roster_entries(booking_id,position,name,team,is_registrant,level,gender,age,birth_date,first_timer,email)
   values(booking_id,player->>'position',player->>'name',team_slot,(player->>'is_registrant')::boolean,profile->>'level',profile->>'gender',(profile->>'age')::int,(profile->>'birth_date')::date,(profile->>'first_timer')::boolean,
    case when (player->>'is_registrant')::boolean then c.organizer_email else dvc_optional_email(player->>'email') end);
   if p_user is not null and (player->>'is_registrant')::boolean then
    insert into player_profiles(organization_id,user_id,name,contact,position,level,gender,birth_date,first_timer)
    values(p_org,p_user,c.organizer_name,c.contact,player->>'position',profile->>'level',profile->>'gender',(profile->>'birth_date')::date,(profile->>'first_timer')::boolean)
    on conflict(organization_id,user_id) do update set name=excluded.name,contact=excluded.contact,position=excluded.position,level=excluded.level,gender=excluded.gender,birth_date=excluded.birth_date,first_timer=excluded.first_timer,updated_at=clock_timestamp();
   end if;
  end loop;
 end loop;
 perform dvc_event(p_org,p_user,'checkout.hold',c.id,p_ref);
 return jsonb_build_object('outcome','created','checkout',dvc_checkout_json(c.id));
end $$;

create function public.dvc_checkout_upload_prepare(p_org uuid,p_user uuid,p_guest text,p_checkout uuid,p_method uuid,p_upload uuid,p_path text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare c checkouts; begin
 select * into c from checkouts where id=p_checkout and organization_id=p_org for update;
 if not found or not dvc_checkout_owned(p_org,p_user,p_guest,p_checkout) then raise exception 'Checkout not found'; end if;
 if c.status<>'holding' or c.expires_at<=clock_timestamp() then raise exception 'Your hold expired or was already completed. Refresh your booking'; end if;
 if exists(select 1 from bookings where checkout_id=c.id and status<>'holding') then raise exception 'A game in this checkout changed. Contact the club'; end if;
 if not exists(select 1 from payment_methods where id=p_method and organization_id=p_org and enabled) then raise exception 'Choose an available payment method'; end if;
 if p_path !~ ('^checkout-receipts/'||c.id::text||'/'||p_upload::text||'\.(png|jpg|webp)$') then raise exception 'Invalid receipt'; end if;
 insert into checkout_receipt_uploads(id,checkout_id,method_id,path) values(p_upload,c.id,p_method,p_path);
end $$;

create function public.dvc_checkout_receipt(p_org uuid,p_user uuid,p_guest text,p_checkout uuid,p_upload uuid,p_ref uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c checkouts; upload checkout_receipt_uploads; game_id uuid; begin
 if not dvc_checkout_owned(p_org,p_user,p_guest,p_checkout) then raise exception 'Checkout not found'; end if;
 for game_id in select distinct b.game_id from bookings b where b.checkout_id=p_checkout order by b.game_id loop
  perform 1 from games where id=game_id for update;
 end loop;
 select * into c from checkouts where id=p_checkout and organization_id=p_org for update;
 select * into upload from checkout_receipt_uploads where id=p_upload and checkout_id=c.id for update;
 if not found then raise exception 'Receipt attempt not found. Retry your upload'; end if;
 if c.status='reserved' and exists(select 1 from checkout_receipts where checkout_id=c.id) then
  if upload.state='pending' then update checkout_receipt_uploads set state='discarded',cleanup_after=clock_timestamp() where id=upload.id; end if;
  return dvc_checkout_json(c.id);
 end if;
 if upload.state<>'pending' then raise exception 'Receipt attempt was released. Retry your upload'; end if;
 -- Check the current clock AFTER game/checkout locks, never transaction-start now().
 if c.status<>'holding' or c.expires_at<=clock_timestamp() then raise exception 'Your hold expired. Review your games again'; end if;
 if exists(select 1 from bookings b join games g on g.id=b.game_id where b.checkout_id=c.id and (b.status<>'holding' or b.expires_at<>c.expires_at or g.status<>'published')) then raise exception 'A game in this checkout changed. Contact the club'; end if;
 if not exists(select 1 from payment_methods where id=upload.method_id and organization_id=p_org and enabled) then raise exception 'Choose an available payment method'; end if;
 if not exists(select 1 from storage.objects where bucket_id='dvc-private' and name=upload.path) then raise exception 'Receipt image is unavailable. Retry your upload'; end if;
 insert into checkout_receipts(checkout_id,upload_id,method_id,path) values(c.id,upload.id,upload.method_id,upload.path);
 update checkout_receipt_uploads set state='committed' where id=upload.id;
 update bookings set status='reserved',payment_status='approved' where checkout_id=c.id;
 update checkouts set status='reserved',payment_status='approved' where id=c.id;
 perform dvc_event(p_org,p_user,'checkout.receipt',c.id,p_ref);
 return dvc_checkout_json(c.id);
end $$;

-- Serializing release with finalization fences a future/delayed RPC. A receipt
-- which already committed is returned, and its object can never be released.
create function public.dvc_checkout_upload_release(p_org uuid,p_user uuid,p_guest text,p_checkout uuid,p_upload uuid,p_confirmed_upload boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c checkouts; upload checkout_receipt_uploads; begin
 select * into c from checkouts where id=p_checkout and organization_id=p_org for update;
 if not found or not dvc_checkout_owned(p_org,p_user,p_guest,p_checkout) then return null; end if;
 select * into upload from checkout_receipt_uploads where id=p_upload and checkout_id=c.id for update;
 if not found then return null; end if;
 if upload.state='committed' or exists(select 1 from checkout_receipts where upload_id=upload.id) then return jsonb_build_object('committed',true,'checkout',dvc_checkout_json(c.id)); end if;
 update checkout_receipt_uploads set state='discarded',cleanup_after=case when p_confirmed_upload then clock_timestamp() else greatest(cleanup_after,clock_timestamp()+interval '2 minutes') end where id=upload.id;
 return jsonb_build_object('committed',false,'path',upload.path,'delete_now',p_confirmed_upload);
end $$;

create function public.dvc_checkout_cleanup_candidates(p_org uuid,p_user uuid,p_guest text,p_checkout uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c checkouts; result jsonb; begin
 select * into c from checkouts where id=p_checkout and organization_id=p_org for update;
 if not found or not dvc_checkout_owned(p_org,p_user,p_guest,p_checkout) then return '[]'::jsonb; end if;
 update checkout_receipt_uploads set state='discarded'
 where checkout_id=c.id and state='pending' and cleanup_after<=clock_timestamp()
 and (c.status<>'holding' or c.expires_at<=clock_timestamp())
 and not exists(select 1 from checkout_receipts r where r.upload_id=checkout_receipt_uploads.id);
 select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'path',u.path)),'[]') into result from (
  select id,path from checkout_receipt_uploads where checkout_id=c.id and state='discarded' and cleanup_after<=clock_timestamp()
  -- Revisit retained tombstones fairly: oldest creation alone can starve
  -- later attempts forever once the first batch becomes eligible again.
  and (checked_at is null or checked_at<clock_timestamp()-interval '1 minute')
  order by checked_at asc nulls first,created_at,id limit 20
 ) u;
 return result;
end $$;
create function public.dvc_checkout_cleanup_checked(p_org uuid,p_user uuid,p_guest text,p_checkout uuid,p_upload uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not dvc_checkout_owned(p_org,p_user,p_guest,p_checkout) then return; end if;
 update checkout_receipt_uploads set checked_at=clock_timestamp() where id=p_upload and checkout_id=p_checkout and state='discarded';
end $$;

-- The legacy paths remain for explicit old bookings/manual staff operations.
-- New checkout bookings cannot be finalized or manually reviewed one at a time.
alter function public.dvc_receipt(uuid,uuid,text,uuid,uuid,text,uuid) rename to dvc_legacy_receipt;
create function public.dvc_receipt(p_org uuid,p_user uuid,p_guest text,p_booking uuid,p_method uuid,p_path text,p_ref uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare b bookings; role text:=dvc_role(p_org,p_user);
begin
 select * into b from bookings where id=p_booking and organization_id=p_org;
 if not found or (not dvc_owned(p_org,p_user,p_guest,p_booking) and role not in ('developer','admin')) then raise exception 'Booking not found'; end if;
 perform 1 from games where id=b.game_id for update;
 select * into b from bookings where id=p_booking and organization_id=p_org for update;
 if b.checkout_id is not null then raise exception 'Use this booking''s combined checkout payment'; end if;
 -- The retained implementation uses now(). Fence its call with a current-clock
 -- check after all relevant locks, so an old receipt cannot revive capacity
 -- that a new checkout acquired while the legacy request was waiting.
 if not (b.status='reserved' and (exists(select 1 from receipts where booking_id=b.id) or (b.manual and role in ('developer','admin'))))
  and (b.status<>'holding' or b.expires_at<=clock_timestamp()) then raise exception 'Your hold expired. Register again'; end if;
 perform dvc_legacy_receipt(p_org,p_user,p_guest,p_booking,p_method,p_path,p_ref);
end $$;
alter function public.dvc_admin(uuid,uuid,text,jsonb,uuid) rename to dvc_legacy_admin;
create function public.dvc_admin(p_org uuid,p_user uuid,p_action text,p_data jsonb,p_ref uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_action in ('booking.transfer','booking.details','receipt.approve','receipt.reject') and exists(select 1 from bookings where id=(p_data->>'id')::uuid and organization_id=p_org and (checkout_id is not null or kind='group')) then raise exception 'This checkout operation is not available yet'; end if;
 return dvc_legacy_admin(p_org,p_user,p_action,p_data,p_ref);
end $$;
revoke all on function public.dvc_legacy_receipt(uuid,uuid,text,uuid,uuid,text,uuid),public.dvc_legacy_admin(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;

create or replace function public.dvc_bookings(p_org uuid,p_user uuid,p_guest text) returns jsonb
language sql volatile security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg((to_jsonb(b)-'guest_hash'-'contact'-'user_id'-'quote_snapshot')||jsonb_build_object(
 'status',case when b.checkout_id is not null and b.status='holding' and b.expires_at<=clock_timestamp() then 'expired' else b.status end,
 'venue',g.venue,'maps_url',v.maps_url,'starts_at',g.starts_at,'ends_at',g.ends_at,
 'review_note',(select review_note from receipts where booking_id=b.id),
 'entries',(select jsonb_agg(to_jsonb(r)) from roster_entries r where r.booking_id=b.id))||
 case when c.id is null then '{}'::jsonb else jsonb_build_object('checkout_amount',c.amount,'checkout_status',case when c.status='holding' and c.expires_at<=clock_timestamp() then 'expired' else c.status end,'checkout_payment_status',c.payment_status,'checkout_expires_at',c.expires_at) end
 order by b.created_at desc),'[]')
 from bookings b join games g on g.id=b.game_id left join venues v on v.id=g.venue_id and v.organization_id=p_org left join checkouts c on c.id=b.checkout_id
 where b.organization_id=p_org and case when b.checkout_id is null then dvc_owned(p_org,p_user,p_guest,b.id) else dvc_checkout_owned(p_org,p_user,p_guest,b.checkout_id) end;
$$;

revoke all on function public.dvc_checkout_owned(uuid,uuid,text,uuid),public.dvc_checkout_json(uuid),public.dvc_checkout_read(uuid,uuid,text,uuid),public.dvc_checkout_hold(uuid,uuid,text,jsonb,uuid),public.dvc_checkout_upload_prepare(uuid,uuid,text,uuid,uuid,uuid,text),public.dvc_checkout_receipt(uuid,uuid,text,uuid,uuid,uuid),public.dvc_checkout_upload_release(uuid,uuid,text,uuid,uuid,boolean),public.dvc_checkout_cleanup_candidates(uuid,uuid,text,uuid),public.dvc_checkout_cleanup_checked(uuid,uuid,text,uuid,uuid),public.dvc_receipt(uuid,uuid,text,uuid,uuid,text,uuid),public.dvc_admin(uuid,uuid,text,jsonb,uuid),public.dvc_bookings(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.dvc_checkout_owned(uuid,uuid,text,uuid),public.dvc_checkout_read(uuid,uuid,text,uuid),public.dvc_checkout_hold(uuid,uuid,text,jsonb,uuid),public.dvc_checkout_upload_prepare(uuid,uuid,text,uuid,uuid,uuid,text),public.dvc_checkout_receipt(uuid,uuid,text,uuid,uuid,uuid),public.dvc_checkout_upload_release(uuid,uuid,text,uuid,uuid,boolean),public.dvc_checkout_cleanup_candidates(uuid,uuid,text,uuid),public.dvc_checkout_cleanup_checked(uuid,uuid,text,uuid,uuid),public.dvc_receipt(uuid,uuid,text,uuid,uuid,text,uuid),public.dvc_admin(uuid,uuid,text,jsonb,uuid),public.dvc_bookings(uuid,uuid,text) to service_role;
-- Unscoped JSON assembler is private even from the Data API's service role.
revoke all on function public.dvc_checkout_json(uuid) from service_role;
commit;
