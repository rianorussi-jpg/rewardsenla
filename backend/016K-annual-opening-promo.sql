-- Rewards Enla · Promoción anual de apertura
-- Primeros 50 negocios con plan anual promocional.
-- Ejecutar después de 016J-adminx.sql.

alter table public.rewards_businesses
  add column if not exists billing_interval text not null default 'monthly';

alter table public.rewards_businesses
  drop constraint if exists rewards_businesses_billing_interval_check;

alter table public.rewards_businesses
  add constraint rewards_businesses_billing_interval_check
  check (billing_interval in ('monthly','annual'));

create table if not exists public.rewards_annual_promo_claims (
  business_id uuid primary key references public.rewards_businesses(id) on delete cascade,
  status text not null default 'reserved' check (status in ('reserved','claimed')),
  reserved_at timestamptz not null default now(),
  reserved_until timestamptz,
  claimed_at timestamptz,
  stripe_checkout_session_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists rewards_annual_promo_session_uidx
  on public.rewards_annual_promo_claims(stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

alter table public.rewards_annual_promo_claims enable row level security;
revoke all on table public.rewards_annual_promo_claims from anon, authenticated;
grant all on table public.rewards_annual_promo_claims to service_role;

-- Estado agregado visible para la cuenta autenticada.
create or replace function public.rewards_annual_promo_status()
returns table(
  promo_limit integer,
  claimed_count integer,
  active_reserved_count integer,
  available_count integer,
  has_claim boolean,
  has_reservation boolean,
  promo_open boolean
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_business_id uuid;
  v_claimed integer := 0;
  v_reserved integer := 0;
  v_has_claim boolean := false;
  v_has_reservation boolean := false;
begin
  select b.id into v_business_id
  from public.rewards_businesses b
  where b.owner_id = auth.uid()
  limit 1;

  if v_business_id is null then
    raise exception 'No se encontró el negocio.';
  end if;

  select count(*)::integer into v_claimed
  from public.rewards_annual_promo_claims
  where status='claimed';

  select count(*)::integer into v_reserved
  from public.rewards_annual_promo_claims
  where status='reserved'
    and reserved_until is not null
    and reserved_until > now();

  select exists(
    select 1 from public.rewards_annual_promo_claims
    where business_id=v_business_id and status='claimed'
  ) into v_has_claim;

  select exists(
    select 1 from public.rewards_annual_promo_claims
    where business_id=v_business_id
      and status='reserved'
      and reserved_until is not null
      and reserved_until > now()
  ) into v_has_reservation;

  return query select
    50,
    v_claimed,
    v_reserved,
    greatest(50 - v_claimed - v_reserved, 0),
    v_has_claim,
    v_has_reservation,
    (v_has_claim or (v_claimed + v_reserved < 50));
end;
$$;

grant execute on function public.rewards_annual_promo_status() to authenticated;

-- Reserva atómica de un lugar promocional. Solo service_role.
create or replace function public.rewards_admin_reserve_annual_promo(p_business_id uuid)
returns table(ok boolean,state text,available_count integer,existing_session_id text)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_status text;
  v_until timestamptz;
  v_session text;
  v_used integer;
begin
  perform pg_advisory_xact_lock(9102405001::bigint);

  if not exists(select 1 from public.rewards_businesses where id=p_business_id) then
    raise exception 'Negocio no encontrado.';
  end if;

  select c.status,c.reserved_until,c.stripe_checkout_session_id
    into v_status,v_until,v_session
  from public.rewards_annual_promo_claims c
  where c.business_id=p_business_id;

  if v_status='claimed' then
    select count(*)::integer into v_used
    from public.rewards_annual_promo_claims c
    where c.status='claimed'
       or (c.status='reserved' and c.reserved_until is not null and c.reserved_until>now());
    return query select true,'claimed',greatest(50-v_used,0),v_session;
    return;
  end if;

  if v_status='reserved' and v_until is not null and v_until>now() then
    update public.rewards_annual_promo_claims
      set reserved_until=now()+interval '35 minutes',updated_at=now()
      where business_id=p_business_id;
    select count(*)::integer into v_used
    from public.rewards_annual_promo_claims c
    where c.status='claimed'
       or (c.status='reserved' and c.reserved_until is not null and c.reserved_until>now());
    return query select true,'reserved',greatest(50-v_used,0),v_session;
    return;
  end if;

  select count(*)::integer into v_used
  from public.rewards_annual_promo_claims c
  where c.status='claimed'
     or (c.status='reserved' and c.reserved_until is not null and c.reserved_until>now());

  if v_used>=50 then
    return query select false,'sold_out',0,null::text;
    return;
  end if;

  insert into public.rewards_annual_promo_claims(
    business_id,status,reserved_at,reserved_until,claimed_at,stripe_checkout_session_id,updated_at
  ) values(
    p_business_id,'reserved',now(),now()+interval '35 minutes',null,null,now()
  )
  on conflict (business_id) do update set
    status='reserved',
    reserved_at=now(),
    reserved_until=now()+interval '35 minutes',
    claimed_at=null,
    stripe_checkout_session_id=null,
    updated_at=now();

  return query select true,'reserved',greatest(49-v_used,0),null::text;
end;
$$;

revoke all on function public.rewards_admin_reserve_annual_promo(uuid) from public, anon, authenticated;
grant execute on function public.rewards_admin_reserve_annual_promo(uuid) to service_role;

create or replace function public.rewards_admin_attach_annual_promo_session(
  p_business_id uuid,
  p_session_id text
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
begin
  update public.rewards_annual_promo_claims
  set stripe_checkout_session_id=p_session_id,updated_at=now()
  where business_id=p_business_id and status='reserved';
  if not found then raise exception 'No existe una reserva anual activa.'; end if;
  return true;
end;
$$;

revoke all on function public.rewards_admin_attach_annual_promo_session(uuid,text) from public, anon, authenticated;
grant execute on function public.rewards_admin_attach_annual_promo_session(uuid,text) to service_role;

create or replace function public.rewards_admin_claim_annual_promo(
  p_business_id uuid,
  p_session_id text default null
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  v_status text;
begin
  perform pg_advisory_xact_lock(9102405001::bigint);

  select status into v_status
  from public.rewards_annual_promo_claims
  where business_id=p_business_id
  for update;

  if v_status is null then
    raise exception 'No existe una reserva anual para este negocio.';
  end if;

  if v_status='claimed' then return true; end if;

  update public.rewards_annual_promo_claims
  set status='claimed',
      claimed_at=coalesce(claimed_at,now()),
      reserved_until=null,
      stripe_checkout_session_id=coalesce(p_session_id,stripe_checkout_session_id),
      updated_at=now()
  where business_id=p_business_id;

  return true;
end;
$$;

revoke all on function public.rewards_admin_claim_annual_promo(uuid,text) from public, anon, authenticated;
grant execute on function public.rewards_admin_claim_annual_promo(uuid,text) to service_role;

create or replace function public.rewards_admin_release_annual_promo(
  p_business_id uuid,
  p_session_id text default null
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
begin
  delete from public.rewards_annual_promo_claims
  where business_id=p_business_id
    and status='reserved'
    and (p_session_id is null or stripe_checkout_session_id=p_session_id);
  return true;
end;
$$;

revoke all on function public.rewards_admin_release_annual_promo(uuid,text) from public, anon, authenticated;
grant execute on function public.rewards_admin_release_annual_promo(uuid,text) to service_role;
