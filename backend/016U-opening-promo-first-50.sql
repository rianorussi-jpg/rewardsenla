-- Enla Cards · Promoción de apertura para los primeros 50 negocios
-- Reutiliza rewards_annual_promo_claims como el cupo compartido de apertura.
-- Así el mismo grupo de 50 obtiene tanto los precios mensuales promocionales
-- como la promoción anual existente.
-- Ejecutar después de 016K-annual-opening-promo.sql.

comment on table public.rewards_annual_promo_claims is
  'Cupo compartido de promoción de apertura Enla Cards para los primeros 50 negocios. Nombre histórico conservado por compatibilidad.';

create or replace function public.rewards_opening_promo_public_status()
returns table(
  promo_limit integer,
  claimed_count integer,
  active_reserved_count integer,
  available_count integer,
  promo_open boolean
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_claimed integer := 0;
  v_reserved integer := 0;
begin
  select count(*)::integer into v_claimed
  from public.rewards_annual_promo_claims
  where status='claimed';

  select count(*)::integer into v_reserved
  from public.rewards_annual_promo_claims
  where status='reserved'
    and reserved_until is not null
    and reserved_until > now();

  return query select
    50,
    v_claimed,
    v_reserved,
    greatest(50 - v_claimed - v_reserved, 0),
    (v_claimed + v_reserved < 50);
end;
$$;

revoke all on function public.rewards_opening_promo_public_status() from public;
grant execute on function public.rewards_opening_promo_public_status() to anon, authenticated;
