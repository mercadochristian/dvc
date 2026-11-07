-- DRAFT M6. Apply after combined_checkout.sql and the current staff role draft.
-- These reads do not modify payment history or the Games workspace contract.
-- Revert callers first, then drop the three RPCs and the new indexes below.
begin;

create index m6_checkouts_payment_history on public.checkouts (organization_id, created_at desc, id desc);
create index m6_legacy_payment_history on public.bookings (organization_id, created_at desc, id desc)
  where checkout_id is null and status in ('reserved', 'cancelled', 'rejected');
create index m6_checkout_payment_breakdown on public.bookings (checkout_id, organization_id, created_at desc, id desc)
  where checkout_id is not null;

create function public.dvc_management_payments(
  p_org uuid, p_user uuid, p_limit integer, p_query text, p_status text, p_game uuid,
  p_after_time timestamptz, p_after_id uuid, p_after_kind text
) returns jsonb
language plpgsql stable set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if coalesce(public.dvc_role(p_org, p_user), 'player') not in ('admin', 'developer') then
    raise exception 'Payment management access denied';
  end if;
  if p_limit is null or p_limit not between 1 and 50 or coalesce(length(p_query), 0) > 120
    or (p_status is not null and p_status not in ('approved', 'rejected', 'review', 'missing'))
    or (p_after_time is null) <> (p_after_id is null)
    or (p_after_time is null) <> (p_after_kind is null)
    or (p_after_kind is not null and p_after_kind not in ('legacy', 'checkout')) then
    raise exception 'Invalid payments page';
  end if;

  with candidates as (
    (
      select c.id, c.created_at, 'checkout'::text as kind
      from public.checkouts c
      where c.organization_id = p_org
        and (p_after_time is null or (c.created_at, c.id, 'checkout'::text) < (p_after_time, p_after_id, p_after_kind))
        and (p_status is null or p_status = case when c.payment_status = 'approved' then 'approved' else 'missing' end)
        and (p_game is null or exists (
          select 1 from public.bookings b
          where b.checkout_id = c.id and b.organization_id = p_org and b.game_id = p_game
        ))
        and (coalesce(p_query, '') = ''
          or strpos(lower(concat_ws(' ', c.organizer_name, c.contact, c.id::text)), p_query) > 0
          or exists (
            select 1 from public.bookings b join public.games g on g.id = b.game_id and g.organization_id = p_org
            where b.checkout_id = c.id and b.organization_id = p_org
              and strpos(lower(concat_ws(' ', b.id::text, g.venue)), p_query) > 0
          ))
      order by c.created_at desc, c.id desc
      limit p_limit + 1
    ) union all (
      select b.id, b.created_at, 'legacy'::text as kind
      from public.bookings b join public.games g on g.id = b.game_id and g.organization_id = p_org
      left join public.receipts r on r.booking_id = b.id
      where b.organization_id = p_org and b.checkout_id is null
        and b.status in ('reserved', 'cancelled', 'rejected')
        and (p_after_time is null or (b.created_at, b.id, 'legacy'::text) < (p_after_time, p_after_id, p_after_kind))
        and (p_game is null or b.game_id = p_game)
        and (p_status is null or p_status = case when b.payment_status in ('approved', 'rejected') then b.payment_status
          when r.id is not null then 'review' else 'missing' end)
        and (coalesce(p_query, '') = '' or strpos(lower(concat_ws(' ', b.captain_name, b.contact, b.id::text, g.venue)), p_query) > 0)
      order by b.created_at desc, b.id desc
      limit p_limit + 1
    )
  ), next_page as materialized (
    select * from candidates order by created_at desc, id desc, kind desc limit p_limit + 1
  ), visible as (
    select * from next_page order by created_at desc, id desc, kind desc limit p_limit
  ), projected as (
    select v.*, case when v.kind = 'checkout' then
      jsonb_build_object('kind', v.kind, 'id', v.id, 'created_at', v.created_at,
        'organizer', c.organizer_name, 'contact', c.contact, 'amount', c.amount,
        'status', case when c.status = 'holding' and c.expires_at <= now() then 'expired' else c.status end,
        'payment_status', c.payment_status,
        'receipt', case when cr.id is not null then jsonb_build_object('submitted_at', cr.submitted_at,
          'method', coalesce(pm.label, 'Payment method unavailable')) end)
      else jsonb_build_object('kind', v.kind, 'id', v.id, 'created_at', v.created_at,
        'booking', jsonb_build_object('id', b.id, 'game_id', b.game_id, 'kind', b.kind, 'captain_name', b.captain_name,
          'contact', b.contact, 'amount', b.amount, 'status', b.status, 'payment_status', b.payment_status, 'manual', b.manual,
          'expires_at', b.expires_at, 'created_at', b.created_at,
          'receipt', case when r.id is not null then jsonb_build_object('id', r.id, 'review_note', r.review_note) end),
        'game', jsonb_build_object('id', g.id, 'venue', g.venue, 'starts_at', g.starts_at, 'maps_url', venue.maps_url))
      end as item
    from visible v
    left join public.checkouts c on v.kind = 'checkout' and c.id = v.id and c.organization_id = p_org
    left join public.checkout_receipts cr on cr.checkout_id = c.id
    left join public.payment_methods pm on pm.id = cr.method_id and pm.organization_id = p_org
    left join public.bookings b on v.kind = 'legacy' and b.id = v.id and b.organization_id = p_org
    left join public.receipts r on r.booking_id = b.id
    left join public.games g on g.id = b.game_id and g.organization_id = p_org
    left join public.venues venue on venue.id = g.venue_id and venue.organization_id = p_org
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(item order by created_at desc, id desc, kind desc) from projected), '[]'::jsonb),
    'next_key', case when (select count(*) from next_page) > p_limit then
      (select jsonb_build_object('time', created_at, 'id', id, 'kind', kind)
        from visible order by created_at, id, kind limit 1) end
  ) into result;
  return result;
end;
$$;

create function public.dvc_management_checkout_bookings(
  p_org uuid, p_user uuid, p_limit integer, p_checkout uuid, p_after_time timestamptz, p_after_id uuid
) returns jsonb
language plpgsql stable set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if coalesce(public.dvc_role(p_org, p_user), 'player') not in ('admin', 'developer') then
    raise exception 'Payment management access denied';
  end if;
  if p_limit is null or p_limit not between 1 and 50 or p_checkout is null
    or (p_after_time is null) <> (p_after_id is null) then
    raise exception 'Invalid checkout games page';
  end if;

  with next_page as materialized (
    select b.*
    from public.bookings b join public.checkouts c on c.id = b.checkout_id and c.organization_id = p_org
    where b.organization_id = p_org and b.checkout_id = p_checkout
      and (p_after_time is null or (b.created_at, b.id) < (p_after_time, p_after_id))
    order by b.created_at desc, b.id desc limit p_limit + 1
  ), visible as (
    select * from next_page order by created_at desc, id desc limit p_limit
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'game_id', b.game_id, 'checkout_id', b.checkout_id,
        'kind', b.kind, 'captain_name', b.captain_name, 'amount', b.amount,
        'status', case when b.status = 'holding' and b.expires_at <= now() then 'expired' else b.status end,
        'payment_status', b.payment_status, 'expires_at', b.expires_at, 'created_at', b.created_at,
        'venue', g.venue, 'maps_url', v.maps_url, 'starts_at', g.starts_at, 'ends_at', g.ends_at,
        'game_status', g.status) order by b.created_at desc, b.id desc)
      from visible b join public.games g on g.id = b.game_id and g.organization_id = p_org
      left join public.venues v on v.id = g.venue_id and v.organization_id = p_org
    ), '[]'::jsonb),
    'next_key', case when (select count(*) from next_page) > p_limit then
      (select jsonb_build_object('time', created_at, 'id', id, 'kind', 'booking')
        from visible order by created_at, id limit 1) end
  ) into result;
  return result;
end;
$$;

create function public.dvc_management_payment_games(
  p_org uuid, p_user uuid, p_limit integer, p_date date, p_after_time timestamptz, p_after_id uuid
) returns jsonb
language plpgsql stable set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if coalesce(public.dvc_role(p_org, p_user), 'player') not in ('admin', 'developer') then
    raise exception 'Payment management access denied';
  end if;
  if p_limit is null or p_limit not between 1 and 50 or p_date is null
    or (p_after_time is null) <> (p_after_id is null) then
    raise exception 'Invalid payment game page';
  end if;

  with next_page as materialized (
    select g.id, g.venue, g.starts_at, v.maps_url
    from public.games g left join public.venues v on v.id = g.venue_id and v.organization_id = p_org
    where g.organization_id = p_org
      and g.starts_at >= p_date::timestamp at time zone 'Asia/Manila'
      and g.starts_at < (p_date + 1)::timestamp at time zone 'Asia/Manila'
      and (p_after_time is null or (g.starts_at, g.id) > (p_after_time, p_after_id))
    order by g.starts_at, g.id limit p_limit + 1
  ), visible as (
    select * from next_page order by starts_at, id limit p_limit
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(v) order by starts_at, id) from visible v), '[]'::jsonb),
    'next_key', case when (select count(*) from next_page) > p_limit then
      (select jsonb_build_object('time', starts_at, 'id', id, 'kind', 'game')
        from visible order by starts_at desc, id desc limit 1) end
  ) into result;
  return result;
end;
$$;

revoke all on function public.dvc_management_payments(uuid,uuid,integer,text,text,uuid,timestamptz,uuid,text),
  public.dvc_management_checkout_bookings(uuid,uuid,integer,uuid,timestamptz,uuid),
  public.dvc_management_payment_games(uuid,uuid,integer,date,timestamptz,uuid) from public, anon, authenticated;
grant execute on function public.dvc_management_payments(uuid,uuid,integer,text,text,uuid,timestamptz,uuid,text),
  public.dvc_management_checkout_bookings(uuid,uuid,integer,uuid,timestamptz,uuid),
  public.dvc_management_payment_games(uuid,uuid,integer,date,timestamptz,uuid) to service_role;
commit;
