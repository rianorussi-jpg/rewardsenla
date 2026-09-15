-- rewards.enla · 016E · Color de texto por tarjeta
-- Ejecuta después de 016D.

alter table public.rewards_loyalty_programs
  add column if not exists text_color text not null default '#ffffff';

alter table public.rewards_loyalty_programs
  drop constraint if exists rewards_loyalty_programs_text_color_check;

alter table public.rewards_loyalty_programs
  add constraint rewards_loyalty_programs_text_color_check
  check (text_color ~ '^#[0-9A-Fa-f]{6}$');

-- Datos públicos del programa: promo_text se conserva porque se usa exclusivamente
-- en la pantalla de registro del cliente (join.html).
drop function if exists public.rewards_public_program_card(text);
create function public.rewards_public_program_card(p_program_slug text)
returns table(
  business_name text, program_id uuid, public_slug text, program_name text, display_name text,
  program_type text, goal_count integer, increment_value numeric, reward_text text, promo_text text,
  primary_color text, text_color text, secondary_color text, card_style text, stamp_icon text,
  stamp_filled_image_url text, stamp_empty_image_url text,
  logo_url text, central_image_url text, barcode_format text,
  service_name text, validity_days integer, access_mode text
)
language sql security definer set search_path=public stable as $$
  select b.business_name,p.id,p.public_slug,p.program_name,p.display_name,p.program_type,p.goal_count,
         p.increment_value,p.reward_text,p.promo_text,p.primary_color,p.text_color,p.secondary_color,p.card_style,
         p.stamp_icon,p.stamp_filled_image_url,p.stamp_empty_image_url,p.logo_url,
         case when p.program_type='stamps' then null else p.central_image_url end,
         coalesce(p.barcode_format,'qr'),p.service_name,p.validity_days,p.access_mode
  from public.rewards_loyalty_programs p
  join public.rewards_businesses b on b.id=p.business_id
  where (p.public_slug=p_program_slug or p.id::text=p_program_slug) and p.status='active'
  limit 1;
$$;
grant execute on function public.rewards_public_program_card(text) to anon,authenticated;

-- Tarjeta pública completa: incluye text_color para que la vista web respete
-- la misma elección que Apple Wallet.
drop function if exists public.rewards_public_card(text);
create function public.rewards_public_card(p_code text)
returns table(
  public_code text, customer_name text, current_value numeric, customer_status text,
  business_name text, program_name text, display_name text, program_type text, goal_count integer,
  increment_value numeric, reward_text text, promo_text text, primary_color text, text_color text, secondary_color text,
  card_style text, stamp_icon text, stamp_filled_image_url text, stamp_empty_image_url text,
  logo_url text, central_image_url text, apple_enabled boolean, google_enabled boolean, barcode_format text,
  customer_photo_url text, customer_expires_at timestamptz, last_access_state text,
  service_name text, validity_days integer, access_mode text
)
language sql security definer set search_path=public stable as $$
  select c.public_code,c.name,c.current_value,c.status,b.business_name,p.program_name,p.display_name,
         p.program_type,p.goal_count,p.increment_value,p.reward_text,p.promo_text,p.primary_color,p.text_color,
         p.secondary_color,p.card_style,p.stamp_icon,p.stamp_filled_image_url,p.stamp_empty_image_url,
         p.logo_url,case when p.program_type='stamps' then null else p.central_image_url end,
         p.apple_enabled,p.google_enabled,coalesce(p.barcode_format,'qr'),c.photo_url,c.expires_at,c.last_access_state,
         p.service_name,p.validity_days,p.access_mode
  from public.rewards_customers c
  join public.rewards_businesses b on b.id=c.business_id
  left join public.rewards_loyalty_programs p on p.id=c.program_id
  where c.public_code=upper(p_code)
  limit 1;
$$;
grant execute on function public.rewards_public_card(text) to anon,authenticated;
