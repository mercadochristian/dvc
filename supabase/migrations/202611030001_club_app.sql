-- Apply to a NEW Supabase project. All access goes through Next's server.
begin;
create table public.organizations (
  id uuid primary key default gen_random_uuid(), name text not null
);
insert into public.organizations(id,name) values ('00000000-0000-0000-0000-000000000001','Dreamers Volleyball Club');
create table public.staff_email_whitelist (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations,
  email text not null check(email=lower(trim(email))), role text not null check(role in ('admin','facilitator')),
  enabled boolean not null default true, unique(organization_id,email)
);
create table public.games (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations,
  venue text not null check(length(venue) between 1 and 120), city text not null check(length(city) between 1 and 120),
  starts_at timestamptz not null, ends_at timestamptz not null, check(ends_at>starts_at),
  status text not null default 'draft' check(status in ('draft','published','cancelled','completed')),
  team_price integer not null check(team_price between 0 and 100000000), created_at timestamptz not null default now()
);
create index games_org_date on public.games(organization_id,starts_at);
create table public.game_positions (
  game_id uuid not null references public.games, position text not null check(position in ('open','opposite','middle','setter')),
  capacity integer not null check(capacity between 0 and 120), price integer not null check(price between 0 and 100000000),
  primary key(game_id,position)
);
create table public.payment_methods (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations,
  label text not null check(length(label) between 1 and 100), account_name text not null check(length(account_name) between 1 and 120),
  account_number text not null check(length(account_number) between 1 and 100), qr_path text,
  enabled boolean not null default true,
  check(qr_path is null or qr_path ~ ('^payments/'||organization_id::text||'/[a-f0-9-]{36}\.(png|jpg|webp)$'))
);
create table public.bookings (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations,
  game_id uuid not null references public.games, user_id uuid references auth.users, guest_hash text,
  kind text not null check(kind in ('individual','team')), captain_name text not null check(length(captain_name) between 1 and 100),
  contact text not null check(length(contact) between 3 and 160), amount integer not null check(amount>=0),
  status text not null default 'holding' check(status in ('holding','reserved','cancelled','rejected','expired')),
  payment_status text not null default 'pending' check(payment_status in ('pending','approved','rejected')), manual boolean not null default false,
  expires_at timestamptz not null default (now()+interval '10 minutes'), created_at timestamptz not null default now(),
  check((user_id is not null) <> (guest_hash is not null))
);
create index bookings_game_status on public.bookings(game_id,status,expires_at);
create index bookings_user on public.bookings(user_id);
create index bookings_guest on public.bookings(guest_hash);
create table public.roster_entries (
  id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings,
  position text not null check(position in ('open','opposite','middle','setter')), name text check(length(name) between 1 and 100),
  team integer check(team between 1 and 20)
);
create index roster_booking on public.roster_entries(booking_id);
create table public.receipts (
  id uuid primary key default gen_random_uuid(), booking_id uuid not null unique references public.bookings,
  method_id uuid not null references public.payment_methods, path text not null unique,
  check(path ~ ('^receipts/'||booking_id::text||'/[a-f0-9-]{36}\.(png|jpg|webp)$')),
  submitted_at timestamptz not null default now(), reviewed_at timestamptz, reviewed_by uuid references auth.users,
  review_note text check(length(review_note)<=300)
);
create table public.developer_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations,
  reference_id uuid not null default gen_random_uuid(), actor_id uuid, kind text not null check(kind in ('activity','error')),
  action text not null, entity_id uuid, details jsonb not null default '{}', created_at timestamptz not null default now()
);
create index events_org_date on public.developer_events(organization_id,created_at desc);
create table public.request_limits (
  bucket text not null check(bucket ~ '^[a-f0-9]{64}$'), scope text not null,
  window_at timestamptz not null, hits integer not null, primary key(bucket,scope)
);

-- No direct anon/authenticated table access, including staff and logs.
do $$ declare t text; begin
  foreach t in array array['organizations','staff_email_whitelist','games','game_positions','payment_methods','bookings','roster_entries','receipts','developer_events','request_limits'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;

create function public.dvc_limit(p_bucket text,p_scope text,p_max integer) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare total integer; stamp timestamptz:=to_timestamp(floor(extract(epoch from now())/600)*600); begin
 if p_scope not in ('write','upload','auth','log') or p_max not between 1 and 1000 then raise exception 'Invalid limit'; end if;
 insert into request_limits(bucket,scope,window_at,hits) values(p_bucket,p_scope,stamp,1)
 on conflict(bucket,scope) do update set window_at=stamp,hits=case when request_limits.window_at=stamp then request_limits.hits+1 else 1 end returning hits into total;
 return total<=p_max;
end $$;

create function public.dvc_role(p_org uuid,p_user uuid) returns text
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select w.role from staff_email_whitelist w join auth.users u on lower(u.email)=w.email
    where w.organization_id=p_org and w.enabled and u.id=p_user and u.email_confirmed_at is not null
      and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google'
        and lower(i.identity_data->>'email')=w.email and i.identity_data->>'email_verified'='true') limit 1),'player');
$$;

create function public.dvc_event(p_org uuid,p_actor uuid,p_action text,p_entity uuid,p_ref uuid) returns void
language sql security definer set search_path=public,pg_temp as $$
  insert into developer_events(organization_id,actor_id,kind,action,entity_id,reference_id)
  values(p_org,p_actor,'activity',p_action,p_entity,p_ref);
$$;

create function public.dvc_schedule(p_org uuid,p_from timestamptz,p_to timestamptz) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'venue',g.venue,'city',g.city,'starts_at',g.starts_at,'ends_at',g.ends_at,'status',g.status,'team_price',g.team_price,
  'positions',(select jsonb_agg(jsonb_build_object('position',p.position,'capacity',p.capacity,'price',p.price,'available',greatest(0,p.capacity-(select count(*) from roster_entries r join bookings b on b.id=r.booking_id where b.game_id=g.id and r.position=p.position and (b.status='reserved' or (b.status='holding' and b.expires_at>now()))))) order by p.position) from game_positions p where p.game_id=g.id)) order by g.starts_at),'[]')
 from games g where g.organization_id=p_org and g.status<>'draft' and g.starts_at>=p_from and g.starts_at<p_to;
$$;

create function public.dvc_hold(p_org uuid,p_user uuid,p_guest text,p_data jsonb,p_ref uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare g games; b bookings; p game_positions; required integer; occupied integer; pos text; n integer; kind text:=p_data->>'kind';
begin
 if p_user is null and (p_guest is null or p_guest !~ '^[a-f0-9]{64}$') then raise exception 'Sign in or continue as guest'; end if;
 select * into g from games where id=(p_data->>'game_id')::uuid and organization_id=p_org for update;
 if not found or g.status<>'published' or g.starts_at<=now() then raise exception 'This game is closed'; end if;
 if kind not in ('individual','team') or kind is null then raise exception 'Choose individual or team'; end if;
 if coalesce(p_data->>'position','') not in ('open','opposite','middle','setter') then raise exception 'Choose a position'; end if;
 -- Expiry is evaluated in every availability check; no cron is required for correctness.
 update bookings set status='expired' where game_id=g.id and status='holding' and expires_at<=now();
 if (select count(*) from bookings where organization_id=p_org and ((p_user is not null and user_id=p_user) or guest_hash=p_guest) and created_at>now()-interval '1 hour')>=15 then raise exception 'Too many attempts. Try again later'; end if;
 if exists(select 1 from bookings where game_id=g.id and ((p_user is not null and user_id=p_user) or guest_hash=p_guest) and (status='reserved' or(status='holding' and expires_at>now()))) then raise exception 'You already have a booking for this game'; end if;
 foreach pos in array array['open','opposite','middle','setter'] loop
  required:=case when kind='team' then case when pos in ('open','middle') then 2 else 1 end when pos=p_data->>'position' then 1 else 0 end;
  if required>0 then
   select * into p from game_positions where game_id=g.id and position=pos;
   select count(*) into occupied from roster_entries r join bookings x on x.id=r.booking_id where x.game_id=g.id and r.position=pos and (x.status='reserved' or (x.status='holding' and x.expires_at>now()));
   if p.game_id is null or occupied+required>p.capacity then raise exception 'That position is no longer available'; end if;
  end if;
 end loop;
 if kind='individual' and not exists(select 1 from game_positions where game_id=g.id and position=p_data->>'position') then raise exception 'Choose a position'; end if;
 insert into bookings(organization_id,game_id,user_id,guest_hash,kind,captain_name,contact,amount)
 values(p_org,g.id,p_user,p_guest,kind,trim(p_data->>'name'),trim(p_data->>'contact'),case when kind='team' then g.team_price else (select price from game_positions where game_id=g.id and position=p_data->>'position') end) returning * into b;
 foreach pos in array array['open','opposite','middle','setter'] loop
  required:=case when kind='team' then case when pos in ('open','middle') then 2 else 1 end when pos=p_data->>'position' then 1 else 0 end;
  for n in 1..required loop
   insert into roster_entries(booking_id,position,name) values(b.id,pos,case when pos=p_data->>'position' and n=1 then b.captain_name else null end);
  end loop;
 end loop;
 perform dvc_event(p_org,p_user,'booking.hold',b.id,p_ref);
 return to_jsonb(b)-'guest_hash'-'contact';
end $$;

create function public.dvc_owned(p_org uuid,p_user uuid,p_guest text,p_booking uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from bookings where id=p_booking and organization_id=p_org and ((p_user is not null and user_id=p_user) or (user_id is null and p_guest is not null and guest_hash=p_guest)));
$$;

create function public.dvc_receipt(p_org uuid,p_user uuid,p_guest text,p_booking uuid,p_method uuid,p_path text,p_ref uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare b bookings; begin
 select * into b from bookings where id=p_booking and organization_id=p_org;
 if not found or (not dvc_owned(p_org,p_user,p_guest,p_booking) and dvc_role(p_org,p_user)<>'admin') then raise exception 'Booking not found'; end if;
 perform 1 from games where id=b.game_id for update;
 select * into b from bookings where id=p_booking for update;
 if b.status='reserved' and exists(select 1 from receipts where booking_id=b.id) then return; end if;
 if not (b.status='reserved' and b.manual and dvc_role(p_org,p_user)='admin') and (b.status<>'holding' or b.expires_at<=now()) then raise exception 'Your hold expired. Register again'; end if;
 if not exists(select 1 from payment_methods where id=p_method and organization_id=p_org and enabled) then raise exception 'Choose an available payment method'; end if;
 if p_path not like 'receipts/'||b.id::text||'/%' then raise exception 'Invalid receipt'; end if;
 insert into receipts(booking_id,method_id,path) values(b.id,p_method,p_path);
 update bookings set status='reserved' where id=b.id;
 perform dvc_event(p_org,p_user,'receipt.submitted',b.id,p_ref);
end $$;

create function public.dvc_bookings(p_org uuid,p_user uuid,p_guest text) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg((to_jsonb(b)-'guest_hash'-'contact'-'user_id')||jsonb_build_object('venue',g.venue,'starts_at',g.starts_at,'ends_at',g.ends_at,'review_note',(select review_note from receipts where booking_id=b.id),'entries',(select jsonb_agg(to_jsonb(r)) from roster_entries r where r.booking_id=b.id)) order by b.created_at desc),'[]')
 from bookings b join games g on g.id=b.game_id where b.organization_id=p_org and dvc_owned(p_org,p_user,p_guest,b.id);
$$;

create function public.dvc_roster(p_org uuid,p_game uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',coalesce(split_part(trim(r.name),' ',1),'Player to be named'),'position',r.position,'team',r.team) order by r.team nulls last,r.position,r.name),'[]')
 from roster_entries r join bookings b on b.id=r.booking_id join games g on g.id=b.game_id
 where g.organization_id=p_org and g.id=p_game and g.status<>'draft' and b.status='reserved';
$$;

create function public.dvc_workspace(p_org uuid,p_user uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare role text:=dvc_role(p_org,p_user); result jsonb; begin
 if role not in ('admin','facilitator') then raise exception 'Staff access required'; end if;
 select jsonb_build_object('role',role,'games',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object('positions',(select jsonb_agg(to_jsonb(p)) from game_positions p where p.game_id=g.id)) order by g.starts_at desc) from games g where g.organization_id=p_org),'[]'),
 'roster',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('game_id',b.game_id,'booking_id',b.id,'kind',b.kind)) from roster_entries r join bookings b on b.id=r.booking_id where b.organization_id=p_org and b.status='reserved'),'[]')) into result;
 if role='admin' then
  result:=result||jsonb_build_object('access',coalesce((select jsonb_agg(to_jsonb(w)) from staff_email_whitelist w where organization_id=p_org),'[]'),
   'payments',coalesce((select jsonb_agg(to_jsonb(m)) from payment_methods m where organization_id=p_org),'[]'),
   'bookings',coalesce((select jsonb_agg((to_jsonb(b)-'guest_hash')||jsonb_build_object('receipt',(select to_jsonb(r) from receipts r where r.booking_id=b.id)) order by b.created_at desc) from bookings b where b.organization_id=p_org),'[]'));
 end if;
 return result;
end $$;

create function public.dvc_admin(p_org uuid,p_user uuid,p_action text,p_data jsonb,p_ref uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare role text:=dvc_role(p_org,p_user); entity uuid; g games; b bookings; r roster_entries; p jsonb; occupied integer; pos text; required integer; target games; capacity integer;
begin
 if role not in ('admin','facilitator') or (role<>'admin' and p_action not in ('roster.update')) then raise exception 'Access denied'; end if;
 if p_action='manual.register' then
  p:=dvc_hold(p_org,null,replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),p_data,p_ref);
  entity:=(p->>'id')::uuid;
  update bookings set status='reserved',manual=true where id=entity;
 elsif p_action='game.save' then
  entity:=coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
  select * into g from games where id=entity and organization_id=p_org for update;
  if not found and p_data->>'id' is not null then raise exception 'Game not found'; end if;
  if exists(select 1 from games where id=entity and organization_id<>p_org) then raise exception 'Game not found'; end if;
  if g.id is not null and (g.starts_at<>(p_data->>'starts_at')::timestamptz or g.ends_at<>(p_data->>'ends_at')::timestamptz or g.venue<>p_data->>'venue')
   and exists(select 1 from bookings where game_id=g.id and status='reserved') and coalesce((p_data->>'confirm_change')::boolean,false)=false then raise exception 'Confirm this schedule change for existing players'; end if;
  if p_data->>'status' not in ('draft','published','completed') then raise exception 'Use cancel to cancel a game'; end if;
  if g.status='cancelled' then raise exception 'Create a new game instead of reopening a cancelled game'; end if;
  if p_data->>'status'='draft' and exists(select 1 from bookings where game_id=entity and status in ('reserved','holding')) then raise exception 'A game with bookings cannot return to draft'; end if;
  insert into games(id,organization_id,venue,city,starts_at,ends_at,status,team_price) values(entity,p_org,trim(p_data->>'venue'),trim(p_data->>'city'),(p_data->>'starts_at')::timestamptz,(p_data->>'ends_at')::timestamptz,p_data->>'status',(p_data->>'team_price')::int)
  on conflict(id) do update set venue=excluded.venue,city=excluded.city,starts_at=excluded.starts_at,ends_at=excluded.ends_at,status=excluded.status,team_price=excluded.team_price;
  foreach pos in array array['open','opposite','middle','setter'] loop
   p:=p_data->'positions'->pos;
   if p is null then raise exception 'All four positions are required'; end if;
   select count(*) into occupied from roster_entries re join bookings bo on bo.id=re.booking_id where bo.game_id=entity and re.position=pos and (bo.status='reserved' or (bo.status='holding' and bo.expires_at>now()));
   if (p->>'capacity')::int<occupied then raise exception 'Capacity cannot be below current bookings'; end if;
   insert into game_positions(game_id,position,capacity,price) values(entity,pos,(p->>'capacity')::int,(p->>'price')::int)
   on conflict(game_id,position) do update set capacity=excluded.capacity,price=excluded.price;
  end loop;
 elsif p_action='game.cancel' then
  entity:=(p_data->>'id')::uuid;
  perform 1 from games where id=entity and organization_id=p_org for update;
  if not found then raise exception 'Game not found'; end if;
  update games set status='cancelled' where id=entity;
  update bookings set status='cancelled' where game_id=entity and status in ('holding','reserved');
 elsif p_action='roster.update' then
  entity:=(p_data->>'id')::uuid;
  select re.* into r from roster_entries re join bookings bo on bo.id=re.booking_id where re.id=entity and bo.organization_id=p_org and bo.status='reserved';
  if not found then raise exception 'Player not found'; end if;
  select * into b from bookings where id=r.booking_id;
  perform 1 from games where id=b.game_id for update;
  if not exists(select 1 from bookings where id=b.id and game_id=b.game_id and status='reserved') then raise exception 'Roster changed. Refresh and try again'; end if;
  if nullif(p_data->>'team','') is not null then
   required:=case when r.position in ('open','middle') then 2 else 1 end;
   select count(*) into occupied from roster_entries re join bookings bo on bo.id=re.booking_id where bo.game_id=b.game_id and bo.status='reserved' and re.position=r.position and re.team=(p_data->>'team')::int and re.id<>r.id;
   if occupied>=required then raise exception 'That team position is full'; end if;
  end if;
  update roster_entries set name=nullif(trim(p_data->>'name'),''),team=nullif(p_data->>'team','')::int where id=entity;
 elsif p_action in ('booking.cancel','receipt.approve','receipt.reject','booking.transfer') then
  entity:=(p_data->>'id')::uuid;
  select * into b from bookings where id=entity and organization_id=p_org;
  if not found then raise exception 'Booking not found'; end if;
  -- Stable ordering prevents reciprocal transfer deadlocks.
  perform 1 from games where id in (b.game_id,nullif(p_data->>'game_id','')::uuid) order by id for update;
  if not exists(select 1 from bookings where id=entity and game_id=b.game_id) then raise exception 'Booking moved. Refresh and try again'; end if;
  select * into b from bookings where id=entity for update;
  if b.status not in ('reserved','holding') then raise exception 'Booking is no longer active'; end if;
  if p_action='booking.cancel' then update bookings set status='cancelled' where id=entity;
  elsif p_action in ('receipt.approve','receipt.reject') then
   if b.status<>'reserved' or not exists(select 1 from receipts where booking_id=b.id) then raise exception 'No receipt to review'; end if;
   if b.payment_status<>'pending' then raise exception 'Receipt was already reviewed'; end if;
   if p_action='receipt.reject' and length(trim(coalesce(p_data->>'note','')))<3 then raise exception 'Give a rejection reason'; end if;
   update bookings set payment_status=case when p_action='receipt.approve' then 'approved' else 'rejected' end,status=case when p_action='receipt.reject' then 'rejected' else status end where id=entity;
   update receipts set reviewed_at=now(),reviewed_by=p_user,review_note=left(p_data->>'note',300) where booking_id=entity;
  else
   if b.status<>'reserved' then raise exception 'Only reserved bookings can transfer'; end if;
   select * into target from games where id=(p_data->>'game_id')::uuid and organization_id=p_org and status='published' and starts_at>now();
   if not found or target.id=b.game_id then raise exception 'Choose another open game'; end if;
   if b.amount<>(case when b.kind='team' then target.team_price else (select price from game_positions where game_id=target.id and position=(select position from roster_entries where booking_id=b.id limit 1)) end) then raise exception 'Transfer requires the same price'; end if;
   foreach pos in array array['open','opposite','middle','setter'] loop
    select count(*) into required from roster_entries where booking_id=b.id and position=pos;
    select count(*) into occupied from roster_entries re join bookings bo on bo.id=re.booking_id where bo.game_id=target.id and re.position=pos and (bo.status='reserved' or(bo.status='holding' and bo.expires_at>now()));
    select gp.capacity into capacity from game_positions gp where gp.game_id=target.id and gp.position=pos;
    if capacity is null or occupied+required>capacity then raise exception 'Target game has insufficient positions'; end if;
   end loop;
   update bookings set game_id=target.id where id=entity;
   update roster_entries set team=null where booking_id=entity;
  end if;
 elsif p_action='access.save' then
  entity:=coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
  -- Serialize whitelist changes and retain at least one enabled admin.
  perform 1 from organizations where id=p_org for update;
  if exists(select 1 from staff_email_whitelist where id=entity and organization_id<>p_org) then raise exception 'Entry not found'; end if;
  insert into staff_email_whitelist(id,organization_id,email,role,enabled) values(entity,p_org,lower(trim(p_data->>'email')),p_data->>'role',(p_data->>'enabled')::boolean)
  on conflict(id) do update set email=excluded.email,role=excluded.role,enabled=excluded.enabled;
  if not exists(select 1 from auth.users au where dvc_role(p_org,au.id)='admin') then raise exception 'Keep at least one enabled, verified admin'; end if;
 elsif p_action='payment.save' then
  entity:=coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
  if exists(select 1 from payment_methods where id=entity and organization_id<>p_org) then raise exception 'Method not found'; end if;
  if nullif(p_data->>'qr_path','') is not null and p_data->>'qr_path' !~ ('^payments/'||p_org::text||'/[a-f0-9-]{36}\.(png|jpg|webp)$') then raise exception 'Invalid QR image'; end if;
  insert into payment_methods(id,organization_id,label,account_name,account_number,qr_path,enabled)
  values(entity,p_org,trim(p_data->>'label'),trim(p_data->>'account_name'),trim(p_data->>'account_number'),nullif(p_data->>'qr_path',''),(p_data->>'enabled')::boolean)
  on conflict(id) do update set label=excluded.label,account_name=excluded.account_name,account_number=excluded.account_number,qr_path=excluded.qr_path,enabled=excluded.enabled;
 else raise exception 'Unknown action'; end if;
 perform dvc_event(p_org,p_user,p_action,entity,p_ref);
 update developer_events set details=jsonb_build_object('fields',(select jsonb_agg(k) from jsonb_object_keys(p_data) k where k not in ('contact','name','email','account_name','account_number','note'))) where reference_id=p_ref and kind='activity' and actor_id=p_user;
 return entity;
end $$;

-- Private assets: browser never receives a bucket service credential.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('dvc-private','dvc-private',false,3145728,array['image/jpeg','image/png','image/webp']);

do $$ declare f record; begin
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname like 'dvc_%' loop
  execute format('revoke all on function %s from public, anon, authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
