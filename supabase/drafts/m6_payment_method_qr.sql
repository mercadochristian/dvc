-- Apply after M5. The service passes p_proven_path only after verifying the
-- upload receipt signed by the application for this actor and method.
begin;
create table public.payment_method_creation_intents (
  organization_id uuid not null references public.organizations,
  actor_id uuid not null,
  request_id uuid not null,
  payload jsonb not null,
  method_id uuid not null,
  primary key (organization_id, actor_id, request_id)
);
alter table public.payment_method_creation_intents enable row level security;
revoke all on public.payment_method_creation_intents from public, anon, authenticated;

create function public.dvc_management_payment_save(
  p_org uuid, p_user uuid, p_data jsonb, p_proven_path text, p_ref uuid
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  method_id uuid := (p_data->>'id')::uuid;
  requested_path text := nullif(p_data->>'qr_path', '');
  current_path text;
  request_id uuid := (p_data->>'request_id')::uuid;
  payload jsonb := p_data - 'request_id';
  prior payment_method_creation_intents%rowtype;
  saved_id uuid;
begin
  perform 1 from organizations where id = p_org for update;
  if dvc_role(p_org, p_user) not in ('admin', 'developer') then
    raise insufficient_privilege using message = 'Access denied';
  end if;
  if method_id is null then
    if request_id is null then raise exception 'A payment method creation request is required'; end if;
    select i.* into prior from payment_method_creation_intents i
    where i.organization_id = p_org and i.actor_id = p_user
      and i.request_id = (p_data->>'request_id')::uuid;
    if found then
      if prior.payload <> payload then
        raise exception 'This request already created a payment method with different details. Check Payment methods.';
      end if;
      return prior.method_id;
    end if;
  end if;

  select qr_path into current_path from payment_methods
  where id = method_id and organization_id = p_org;
  if requested_path is not null and requested_path is distinct from current_path then
    if requested_path is distinct from p_proven_path
      or not exists (select 1 from storage.objects where bucket_id = 'dvc-private' and name = requested_path)
      or exists (
        select 1 from payment_methods where organization_id = p_org
          and qr_path = requested_path and id is distinct from method_id
      )
    then
      raise exception 'Upload a QR image for this payment method before saving';
    end if;
  end if;
  saved_id := dvc_admin(p_org, p_user, 'payment.save', payload, p_ref);
  if method_id is null then
    insert into payment_method_creation_intents values (p_org, p_user, request_id, payload, saved_id);
  end if;
  return saved_id;
end;
$$;
revoke all on function public.dvc_management_payment_save(uuid,uuid,jsonb,text,uuid) from public, anon, authenticated;
grant execute on function public.dvc_management_payment_save(uuid,uuid,jsonb,text,uuid) to service_role;
commit;
