-- Apply after game_flow_milestones.sql and the current game administration drafts.
-- Preview installs the trigger disabled. Enable it only after approving delivery and retention.
-- Preserve the outbox when reverting app callers so delivery history stays available.
begin;

create table public.game_schedule_notice_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  game_id uuid not null references public.games on delete cascade,
  recipient text,
  event text not null check (event in ('rescheduled', 'cancelled')),
  old_venue text not null,
  venue text not null,
  old_starts_at timestamptz not null,
  old_ends_at timestamptz not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'error', 'superseded')),
  created_at timestamptz not null default clock_timestamp(),
  available_at timestamptz not null default clock_timestamp(),
  first_attempt_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  lease_token uuid,
  lease_expires_at timestamptz,
  superseded boolean not null default false,
  sent_at timestamptz,
  check (
    (status = 'sending' and lease_token is not null and lease_expires_at is not null)
    or (status <> 'sending' and lease_token is null and lease_expires_at is null)
  ),
  check ((status = 'sent') = (sent_at is not null)),
  check ((attempt_count = 0) = (first_attempt_at is null))
);

create index game_schedule_notice_ready
  on public.game_schedule_notice_outbox (organization_id, available_at, id)
  where status in ('pending', 'sending');

create index game_schedule_notice_game_active
  on public.game_schedule_notice_outbox (organization_id, game_id, recipient, lease_expires_at)
  where status in ('pending', 'sending');

alter table public.game_schedule_notice_outbox enable row level security;
revoke all on public.game_schedule_notice_outbox from public, anon, authenticated, service_role;
grant select, update on public.game_schedule_notice_outbox to service_role;

create function public.dvc_queue_game_schedule_notice() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  notice_event text;
begin
  if new.status = 'cancelled' and old.status is distinct from new.status then
    notice_event := 'cancelled';
  elsif (new.starts_at, new.ends_at) is distinct from (old.starts_at, old.ends_at)
    and old.status <> 'cancelled' and new.status <> 'cancelled' then
    notice_event := 'rescheduled';
  else
    return new;
  end if;

  -- This trigger runs with the game row locked. An older send already leased
  -- may finish, but it cannot be retried after a newer schedule is committed.
  update game_schedule_notice_outbox
  set superseded = true,
      recipient = case when status = 'pending' then null else recipient end,
      status = case when status = 'pending' then 'superseded' else status end
  where organization_id = new.organization_id and game_id = new.id
    and event = 'rescheduled' and status in ('pending', 'sending');

  -- dvc_admin cancels the game before changing its bookings, so reserved
  -- bookings are still visible to this trigger in the cancellation transaction.
  insert into game_schedule_notice_outbox (
    organization_id, game_id, recipient, event, old_venue, venue,
    old_starts_at, old_ends_at, starts_at, ends_at
  )
  with reserved as materialized (
    select id, lower(trim(organizer_email)) as organizer_email, lower(trim(contact)) as contact
    from bookings
    where organization_id = new.organization_id and game_id = new.id and status = 'reserved'
  ),
  candidates as (
    select case
      when length(organizer_email) <= 254
        and organizer_email ~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+[.][^[:space:]@,;<>]+$'
      then organizer_email else contact
    end as email
    from reserved
    union all
    select lower(trim(r.email))
    from reserved b
    join roster_entries r on r.booking_id = b.id
    where nullif(trim(r.name), '') is not null
  )
  select distinct new.organization_id, new.id, email, notice_event, old.venue, new.venue,
    old.starts_at, old.ends_at, new.starts_at, new.ends_at
  from candidates
  where length(email) <= 254
    and email ~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+[.][^[:space:]@,;<>]+$';

  return new;
end
$$;

create trigger dvc_queue_game_schedule_notice
after update of starts_at, ends_at, status on public.games
for each row
when ((old.starts_at, old.ends_at, old.status) is distinct from (new.starts_at, new.ends_at, new.status))
execute function public.dvc_queue_game_schedule_notice();

alter table public.games disable trigger dvc_queue_game_schedule_notice;

create function public.dvc_claim_game_notices(p_org uuid) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  claim_time timestamptz := clock_timestamp();
  result jsonb;
begin
  -- Sweep a bounded batch of expired work. Provider idempotency lasts 24 hours,
  -- so retries stop an hour early even if the scheduler was paused.
  with expired as (
    select id
    from game_schedule_notice_outbox
    where organization_id = p_org
      and status in ('pending', 'sending') and available_at <= claim_time
      and (status = 'pending' or lease_expires_at <= claim_time)
      and (superseded or attempt_count >= 5 or first_attempt_at <= claim_time - interval '23 hours'
        or created_at <= claim_time - interval '24 hours')
    order by available_at, id
    limit 10
    for update skip locked
  )
  update game_schedule_notice_outbox n
  set status = case when n.superseded then 'superseded' else 'error' end,
      recipient = null, lease_token = null, lease_expires_at = null
  from expired e where n.id = e.id;

  with candidates as (
    select n.id
    from game_schedule_notice_outbox n
    where n.organization_id = p_org
      and n.status in ('pending', 'sending') and n.available_at <= claim_time
      and (n.status = 'pending' or n.lease_expires_at <= claim_time)
      and not n.superseded and n.attempt_count < 5
      and n.created_at > claim_time - interval '24 hours'
      and (n.first_attempt_at is null or n.first_attempt_at > claim_time - interval '23 hours')
      and not exists (
        select 1 from game_schedule_notice_outbox older
        where older.organization_id = n.organization_id and older.game_id = n.game_id
          and older.recipient = n.recipient and older.id <> n.id
          and older.status = 'sending' and older.lease_expires_at > claim_time
      )
    order by n.available_at, n.id
    limit 10
    for update of n skip locked
  ),
  claimed as (
    update game_schedule_notice_outbox n
    set status = 'sending', first_attempt_at = coalesce(n.first_attempt_at, claim_time),
        attempt_count = n.attempt_count + 1, lease_token = gen_random_uuid(),
        lease_expires_at = claim_time + interval '120 seconds',
        available_at = claim_time + interval '120 seconds'
    from candidates c where n.id = c.id
    returning n.id, n.lease_token, n.recipient, n.event, n.venue, n.old_starts_at, n.old_ends_at, n.starts_at, n.ends_at
  )
  select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]'::jsonb) into result from claimed c;

  return result;
end
$$;

create function public.dvc_finish_game_notice(p_org uuid, p_id uuid, p_lease uuid, p_outcome text)
returns boolean
language plpgsql set search_path = public, pg_temp as $$
declare
  finish_time timestamptz := clock_timestamp();
  final_status text;
begin
  if p_outcome is null or p_outcome not in ('sent', 'retry', 'defer', 'error') then
    raise exception 'Invalid game notice outcome';
  end if;

  update game_schedule_notice_outbox
  set status = case
        when p_outcome = 'sent' then 'sent'
        when superseded then 'superseded'
        when p_outcome = 'defer' then 'pending'
        when p_outcome = 'retry' and attempt_count < 5
          and first_attempt_at + interval '23 hours' > finish_time + make_interval(mins => 1 << (attempt_count - 1))
        then 'pending'
        else 'error'
      end,
      sent_at = case when p_outcome = 'sent' then finish_time end,
      available_at = finish_time + case when p_outcome = 'defer' then interval '15 minutes'
        else make_interval(mins => 1 << (attempt_count - 1)) end,
      attempt_count = attempt_count - case when p_outcome = 'defer' then 1 else 0 end,
      first_attempt_at = case when p_outcome = 'defer' and attempt_count = 1 then null else first_attempt_at end,
      lease_token = null, lease_expires_at = null
  where organization_id = p_org and id = p_id and status = 'sending' and lease_token = p_lease
  returning status into final_status;

  if final_status in ('sent', 'error', 'superseded') then
    update game_schedule_notice_outbox set recipient = null where organization_id = p_org and id = p_id;
  end if;
  return final_status is not null;
end
$$;

-- Keep the existing game-save permissions and validations. For editor saves,
-- reject a stale start time before a retry can overwrite a newer schedule.
create function public.dvc_save_game_with_expected_start(
  p_org uuid, p_user uuid, p_data jsonb, p_expected_start timestamptz, p_ref uuid
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_start timestamptz;
begin
  if coalesce(public.dvc_role(p_org, p_user), 'player') not in ('admin', 'developer') then
    raise insufficient_privilege using message = 'Access denied';
  end if;
  select starts_at into current_start from public.games
  where organization_id = p_org and id = (p_data->>'id')::uuid for update;
  if not found then raise exception 'Game not found'; end if;
  if current_start is distinct from p_expected_start then
    raise exception 'The game start time changed. Close and reopen the editor before saving.';
  end if;
  return public.dvc_admin(p_org, p_user, 'game.save', p_data, p_ref);
end
$$;
revoke all on function public.dvc_save_game_with_expected_start(uuid, uuid, jsonb, timestamptz, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.dvc_save_game_with_expected_start(uuid, uuid, jsonb, timestamptz, uuid) to service_role;

revoke all on function public.dvc_queue_game_schedule_notice(),
  public.dvc_claim_game_notices(uuid), public.dvc_finish_game_notice(uuid, uuid, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.dvc_claim_game_notices(uuid),
  public.dvc_finish_game_notice(uuid, uuid, uuid, text)
to service_role;

commit;
