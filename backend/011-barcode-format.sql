-- 011: QR o código de barras por tarjeta

alter table public.rewards_loyalty_programs
  add column if not exists barcode_format text not null default 'qr';

alter table public.rewards_loyalty_programs
  drop constraint if exists rewards_loyalty_programs_barcode_format_check;

alter table public.rewards_loyalty_programs
  add constraint rewards_loyalty_programs_barcode_format_check
  check (barcode_format in ('qr','code128'));

-- La tarjeta pública necesita conocer el formato seleccionado.
drop function if exists public.rewards_public_card(text);
create function public.rewards_public_card(p_code text)
returns table(
  public_code text, customer_name text, current_value numeric, customer_status text,
  business_name text, program_name text, display_name text, program_type text, goal_count integer,
  increment_value numeric, reward_text text, promo_text text, primary_color text, secondary_color text,
  card_style text, stamp_icon text, stamp_filled_image_url text, stamp_empty_image_url text,
  logo_url text, central_image_url text, apple_enabled boolean, google_enabled boolean, barcode_format text
)
language sql security definer set search_path=public stable as $$
  select c.public_code,c.name,c.current_value,c.status,b.business_name,p.program_name,p.display_name,
         p.program_type,p.goal_count,p.increment_value,p.reward_text,p.promo_text,p.primary_color,
         p.secondary_color,p.card_style,p.stamp_icon,p.stamp_filled_image_url,p.stamp_empty_image_url,
         p.logo_url,case when p.program_type='stamps' then null else p.central_image_url end,
         p.apple_enabled,p.google_enabled,coalesce(p.barcode_format,'qr')
  from public.rewards_customers c
  join public.rewards_businesses b on b.id=c.business_id
  left join public.rewards_loyalty_programs p on p.id=c.program_id
  where c.public_code=upper(p_code)
  limit 1;
$$;
grant execute on function public.rewards_public_card(text) to anon,authenticated;
