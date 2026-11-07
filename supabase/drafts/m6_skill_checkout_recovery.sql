-- Apply after the current unified_registration.sql and m6_management_skill.sql.
-- Roll back callers first; restore the original function name and service grant.
-- Keep declined intents: they prevent a previously declined key from writing.
begin;
do $$
begin
  if strpos(pg_get_functiondef('public.dvc_checkout_hold(uuid,uuid,text,jsonb,uuid)'::regprocedure),
      'is distinct from saved.level') = 0 then
    raise exception 'Apply the current unified registration hold before skill recovery';
  end if;
end;
$$;
alter function public.dvc_checkout_hold(uuid,uuid,text,jsonb,uuid) rename to dvc_checkout_hold_before_skill_recovery;

create function public.dvc_checkout_hold(p_org uuid,p_user uuid,p_guest text,p_data jsonb,p_ref uuid)
returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  conflict_rows jsonb;
begin
  if p_user is not null then
    -- Keep the owner lock outside the exception subtransaction so the
    -- definitive decline and the failed hold cannot race another retry.
    perform pg_advisory_xact_lock(hashtextextended(p_org::text||':user:'||p_user::text,0));
  end if;
  begin
    return dvc_checkout_hold_before_skill_recovery(p_org,p_user,p_guest,p_data,p_ref);
  exception when raise_exception then
    if p_user is null or SQLERRM <> 'Your saved skill level changed. Reopen registration and try again' then
      raise;
    end if;
    select jsonb_agg(jsonb_build_object('game_id',entry.value->'game_id','code','SKILL_CHANGED'))
      into conflict_rows from jsonb_array_elements(p_data->'games') entry
    where exists (
      select 1 from player_profiles saved
      cross join lateral jsonb_array_elements(entry.value->'players') participant(value)
      where saved.organization_id=p_org and saved.user_id=p_user
        and participant.value->>'is_registrant'='true'
        and participant.value->>'has_details' is distinct from 'false'
        and participant.value->>'level' is distinct from saved.level
    );
    if conflict_rows is null then raise; end if;
    insert into checkout_declined_intents(organization_id,owner_key,request_id,request_fingerprint,conflicts)
      values(p_org,'user:'||p_user::text,(p_data->>'request_id')::uuid,encode(sha256(convert_to(p_data::text,'UTF8')),'hex'),conflict_rows);
    return jsonb_build_object('outcome','selection_conflict','conflicts',conflict_rows);
  end;
end;
$$;

revoke all on function public.dvc_checkout_hold_before_skill_recovery(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.dvc_checkout_hold(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.dvc_checkout_hold(uuid,uuid,text,jsonb,uuid) to service_role;
commit;
