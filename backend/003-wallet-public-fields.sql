-- Ejecuta este archivo UNA vez después de 002-public-qr.sql.
-- Expone solamente los flags necesarios para mostrar/ocultar los botones Wallet en la tarjeta pública.

create or replace function public.rewards_public_card(p_code text)
returns table(
  public_code text,
  customer_name text,
  current_value numeric,
  business_name text,
  program_name text,
  display_name text,
  program_type text,
  goal_count integer,
  reward_text text,
  promo_text text,
  primary_color text,
  stamp_icon text,
  logo_url text,
  apple_enabled boolean,
  google_enabled boolean
)
language sql security definer set search_path=public stable as $$
 select c.public_code,c.name,c.current_value,b.business_name,p.program_name,p.display_name,p.program_type,p.goal_count,p.reward_text,p.promo_text,p.primary_color,p.stamp_icon,p.logo_url,p.apple_enabled,p.google_enabled
 from public.rewards_customers c
 join public.rewards_businesses b on b.id=c.business_id
 left join public.rewards_loyalty_programs p on p.id=c.program_id
 where c.public_code=upper(p_code)
 limit 1;
$$;

grant execute on function public.rewards_public_card(text) to anon, authenticated;
