-- DRAFT: create an official migration with the Supabase CLI before applying.
-- Apply after game_flow_milestones.sql. Persistence only: no network calls/sends.
-- Every row has one stable provider idempotency key for a future delivery worker.
begin;
create table public.booking_confirmation_outbox (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations,
 booking_id uuid not null references public.bookings,
 event text not null default 'booking.confirmed' check(event='booking.confirmed'),
 recipient text not null check(recipient=lower(trim(recipient)) and length(recipient)<=254 and recipient ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 status text not null default 'pending' check(status in ('pending','sending','sent','error')),
 attempt_count integer not null default 0 check(attempt_count>=0),
 lease_token uuid, lease_expires_at timestamptz,
 last_error_code text check(last_error_code in ('PROVIDER_NOT_CONFIGURED','DELIVERY_FAILED','DELIVERY_TIMEOUT','RATE_LIMITED','RECIPIENT_REJECTED','INVALID_RECIPIENT','UNKNOWN_DELIVERY_STATUS')),
 sent_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 idempotency_key text generated always as ('dvc-confirmation-'||id::text) stored,
 unique(booking_id,event,recipient), unique(idempotency_key),
 check((status='sending' and lease_token is not null and lease_expires_at is not null) or (status<>'sending' and lease_token is null and lease_expires_at is null)),
 check((status='sent')=(sent_at is not null))
);
create index booking_confirmation_pending on public.booking_confirmation_outbox(organization_id,status,created_at,id);
alter table public.booking_confirmation_outbox enable row level security;
revoke all on public.booking_confirmation_outbox from public,anon,authenticated;
grant all on public.booking_confirmation_outbox to service_role;

create function public.dvc_enqueue_confirmation(p_booking uuid) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare b bookings; g games; inserted integer; begin
 select * into b from bookings where id=p_booking;
 if not found or b.status<>'reserved' or not exists(select 1 from receipts where booking_id=b.id) then return 0; end if;
 select * into g from games where id=b.game_id;
 insert into booking_confirmation_outbox(organization_id,booking_id,recipient,payload)
 select b.organization_id,b.id,email,jsonb_build_object(
  'booking_reference',b.id,'kind',b.kind,'status','reserved','payment_status',b.payment_status,
  'venue',g.venue,'starts_at',g.starts_at,'ends_at',g.ends_at,'time_zone','Asia/Manila')
 from (
  select distinct lower(trim(candidate)) as email from (
   select coalesce(nullif(trim(b.organizer_email),''),case when b.contact ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then b.contact else null end) as candidate
   union all
   select email from roster_entries where booking_id=b.id and nullif(trim(name),'') is not null
  ) recipients
  where candidate is not null and length(trim(candidate))<=254 and trim(candidate) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
 ) normalized
 on conflict(booking_id,event,recipient) do nothing;
 get diagnostics inserted=row_count;
 return inserted;
end $$;

create function public.dvc_confirmation_after_receipt() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 -- Normal receipt insertion precedes the holding->reserved update and queues there.
 -- A manual registration is already reserved and queues at receipt insertion instead.
 perform dvc_enqueue_confirmation(new.booking_id);
 return new;
end $$;
create function public.dvc_confirmation_after_reservation() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform dvc_enqueue_confirmation(new.id);
 return new;
end $$;
create trigger dvc_confirmation_receipt after insert on public.receipts
 for each row execute function public.dvc_confirmation_after_receipt();
create trigger dvc_confirmation_reserved after update of status on public.bookings
 for each row when (new.status='reserved' and old.status is distinct from new.status)
 execute function public.dvc_confirmation_after_reservation();

create function public.dvc_claim_confirmations(p_org uuid,p_limit integer default 10,p_lease_seconds integer default 120) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; begin
 if p_limit is null or p_limit not between 1 and 100 or p_lease_seconds is null or p_lease_seconds not between 30 and 900 then raise exception 'Check outbox claim limits'; end if;
 with candidates as (
  select o.id from booking_confirmation_outbox o
  where o.organization_id=p_org and (o.status='pending' or (o.status='sending' and o.lease_expires_at<=now()))
   and exists(select 1 from bookings b where b.id=o.booking_id and b.status='reserved')
  order by o.created_at,o.id limit p_limit for update skip locked
 ), claimed as (
  update booking_confirmation_outbox o set status='sending',attempt_count=o.attempt_count+1,
   lease_token=gen_random_uuid(),lease_expires_at=now()+make_interval(secs=>p_lease_seconds),last_error_code=null,updated_at=now()
  from candidates c where o.id=c.id returning o.*
 ) select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at,c.id),'[]') into result from claimed c;
 return result;
end $$;

create function public.dvc_finish_confirmation(p_org uuid,p_id uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare changed integer; begin
 -- A current token may finish after its deadline if no newer worker has claimed it.
 -- If another worker acquired a new token, the stale worker can never finish its row.
 update booking_confirmation_outbox set status='sent',sent_at=now(),lease_token=null,lease_expires_at=null,last_error_code=null,updated_at=now()
 where id=p_id and organization_id=p_org and status='sending' and lease_token=p_lease;
 get diagnostics changed=row_count;
 return changed=1;
end $$;
create function public.dvc_fail_confirmation(p_org uuid,p_id uuid,p_lease uuid,p_code text default 'DELIVERY_FAILED') returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare changed integer; safe_code text; begin
 safe_code:=case when p_code in ('PROVIDER_NOT_CONFIGURED','DELIVERY_FAILED','DELIVERY_TIMEOUT','RATE_LIMITED','RECIPIENT_REJECTED','INVALID_RECIPIENT','UNKNOWN_DELIVERY_STATUS') then p_code else 'DELIVERY_FAILED' end;
 update booking_confirmation_outbox set status='error',lease_token=null,lease_expires_at=null,last_error_code=safe_code,updated_at=now()
 where id=p_id and organization_id=p_org and status='sending' and lease_token=p_lease;
 get diagnostics changed=row_count;
 return changed=1;
end $$;
create function public.dvc_retry_confirmation(p_org uuid,p_user uuid,p_id uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare changed integer; begin
 if dvc_role(p_org,p_user) not in ('developer','admin') then raise exception 'Access denied'; end if;
 -- Errors require an explicit administrator retry. Sent/actively leased rows cannot
 -- be resent via this action, and the stable idempotency key is never replaced.
 update booking_confirmation_outbox set status='pending',last_error_code=null,updated_at=now()
 where id=p_id and organization_id=p_org and status='error';
 get diagnostics changed=row_count;
 return changed=1;
end $$;

revoke all on function public.dvc_enqueue_confirmation(uuid),public.dvc_confirmation_after_receipt(),public.dvc_confirmation_after_reservation(),public.dvc_claim_confirmations(uuid,integer,integer),public.dvc_finish_confirmation(uuid,uuid,uuid),public.dvc_fail_confirmation(uuid,uuid,uuid,text),public.dvc_retry_confirmation(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.dvc_enqueue_confirmation(uuid),public.dvc_claim_confirmations(uuid,integer,integer),public.dvc_finish_confirmation(uuid,uuid,uuid),public.dvc_fail_confirmation(uuid,uuid,uuid,text),public.dvc_retry_confirmation(uuid,uuid,uuid) to service_role;
commit;
