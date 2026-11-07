-- Apply after M5. Roll back the caller first. Preserve the intent history while
-- retries of this candidate remain possible, and retain the games it created.
begin;

create table public.game_creation_intents (
  organization_id uuid not null references public.organizations,
  actor_id uuid not null,
  request_id uuid not null,
  payload jsonb not null,
  game_id uuid not null,
  primary key (organization_id, actor_id, request_id)
);
alter table public.game_creation_intents enable row level security;
revoke all on public.game_creation_intents from public, anon, authenticated;

create function public.dvc_create_game_once(
  p_org uuid, p_user uuid, p_request uuid, p_data jsonb, p_ref uuid
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  prior game_creation_intents%rowtype;
  created_id uuid;
begin
  if p_user is null or p_request is null or p_data is null or p_data ? 'id' then
    raise exception 'Invalid game creation request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':game:' || p_user::text || ':' || p_request::text, 0));
  if dvc_role(p_org, p_user) not in ('admin', 'developer') then
    raise insufficient_privilege using message = 'Access denied';
  end if;
  select * into prior from game_creation_intents
  where organization_id = p_org and actor_id = p_user and request_id = p_request;
  if found then
    if prior.payload <> p_data then
      raise exception 'This request already created a game with different details. Check Games before creating another.';
    end if;
    return prior.game_id;
  end if;
  created_id := dvc_admin(p_org, p_user, 'game.save', p_data, p_ref);
  insert into game_creation_intents values (p_org, p_user, p_request, p_data, created_id);
  return created_id;
end;
$$;

revoke all on function public.dvc_create_game_once(uuid,uuid,uuid,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.dvc_create_game_once(uuid,uuid,uuid,jsonb,uuid) to service_role;

commit;
