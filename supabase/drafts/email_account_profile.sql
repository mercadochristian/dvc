-- DRAFT: apply after unified_registration.sql. Shares the checkout owner lock.
begin;

alter table public.player_profiles alter column position drop not null;

create or replace function public.dvc_create_player_profile(p_org uuid, p_user uuid, p_data jsonb)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':user:' || p_user::text, 0));
  insert into player_profiles (organization_id, user_id, name, contact, level, gender, birth_date, first_timer)
  values (p_org, p_user, p_data->>'name', p_data->>'contact',
    p_data->>'level', p_data->>'gender', (p_data->>'birth_date')::date, (p_data->>'first_timer')::boolean)
  on conflict (organization_id, user_id) do nothing;
end;
$$;

revoke all on function public.dvc_create_player_profile(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.dvc_create_player_profile(uuid, uuid, jsonb) to service_role;

commit;
