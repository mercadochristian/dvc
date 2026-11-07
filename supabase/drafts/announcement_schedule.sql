-- Apply after game_flow_milestones.sql and the current administration drafts.
begin;

alter table public.club_announcements
  add column publish_at timestamptz,
  add column ends_at timestamptz,
  add constraint club_announcement_schedule check (
    (publish_at is null and ends_at is null)
    or (publish_at is not null and ends_at is not null
        and isfinite(publish_at) and isfinite(ends_at) and publish_at < ends_at)
  );

create function public.dvc_save_scheduled_announcement(
  p_org uuid, p_user uuid, p_data jsonb, p_ref uuid
) returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  schedule_start timestamptz := (p_data->>'publish_at')::timestamptz;
  schedule_end timestamptz := (p_data->>'ends_at')::timestamptz;
  announcement_id uuid;
begin
  if schedule_start is null or schedule_end is null or not isfinite(schedule_start) or not isfinite(schedule_end) or schedule_end <= schedule_start then
    raise exception 'Enter a publish time and a later end time';
  end if;
  announcement_id := public.dvc_admin(p_org, p_user, 'announcement.save', p_data, p_ref);
  update public.club_announcements a
  set publish_at = schedule_start, ends_at = schedule_end
  where a.id = announcement_id and a.organization_id = p_org;
  return announcement_id;
end
$$;

revoke all on function public.dvc_save_scheduled_announcement(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.dvc_save_scheduled_announcement(uuid, uuid, jsonb, uuid) to service_role;

create or replace function public.dvc_announcements(p_org uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(visible) order by updated_at desc, id), '[]')
  from (
    select id, title, body, enabled, updated_at, publish_at, ends_at
    from public.club_announcements
    where organization_id = p_org and enabled
      and (publish_at is null or (publish_at <= now() and now() < ends_at))
    order by updated_at desc, id
    limit 50
  ) visible;
$$;

commit;
