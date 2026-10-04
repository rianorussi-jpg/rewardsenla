-- Enla Cards · Pro con empleados ilimitados por tarjeta
-- Ejecutar despues de las migraciones de billing/limites existentes.
-- Mantiene todos los limites actuales y cambia unicamente el cupo de staff de Pro.

create or replace function public.rewards_plan_limits(p_plan text)
returns jsonb language sql immutable as $$
 select case p_plan
  when 'business' then jsonb_build_object(
    'cards',15,'published_cards',15,'draft_cards',2147483647,
    'clients',2147483647,'staff',2147483647,'notifications',2147483647,
    'geolocation',true,'geo_locations_per_card',2)
  when 'pro' then jsonb_build_object(
    'cards',5,'published_cards',5,'draft_cards',2147483647,
    'clients',2147483647,'staff',2147483647,'notifications',2147483647,
    'geolocation',true,'geo_locations_per_card',2)
  when 'basic' then jsonb_build_object(
    'cards',1,'published_cards',1,'draft_cards',15,
    'clients',1000,'staff',1,'notifications',0,
    'geolocation',true,'geo_locations_per_card',1)
  else jsonb_build_object(
    'cards',0,'published_cards',0,'draft_cards',15,
    'clients',3,'staff',0,'notifications',0,
    'geolocation',false,'geo_locations_per_card',0)
 end;
$$;
