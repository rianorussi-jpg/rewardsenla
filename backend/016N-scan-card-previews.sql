-- Enla Cards · 016N · Vista previa de tarjetas en Scan
-- Ejecutar una sola vez en Supabase SQL Editor después de 016M.
--
-- Amplía rewards_scan_programs() con los campos visuales necesarios
-- para que /scan muestre una miniatura reconocible de cada tarjeta.

drop function if exists public.rewards_scan_programs();

create function public.rewards_scan_programs()
returns table(
  id uuid,
  program_name text,
  display_name text,
  program_type text,
  logo_url text,
  primary_color text,
  text_color text,
  goal_count integer,
  reward_text text,
  promo_text text,
  stamp_icon text,
  central_image_url text,
  service_name text,
  validity_days integer,
  access_mode text,
  access_role text
)
language sql
security definer
stable
set search_path=public
as $$
  with owned as (
    select
      p.id,
      p.program_name,
      p.display_name,
      p.program_type,
      p.logo_url,
      p.primary_color,
      p.text_color,
      p.goal_count,
      p.reward_text,
      p.promo_text,
      p.stamp_icon,
      case when p.program_type='stamps' then null else p.central_image_url end as central_image_url,
      p.service_name,
      p.validity_days,
      p.access_mode,
      'owner'::text as access_role
    from public.rewards_loyalty_programs p
    join public.rewards_businesses b on b.id=p.business_id
    where b.owner_id=auth.uid()
  ),
  staff as (
    select
      p.id,
      p.program_name,
      p.display_name,
      p.program_type,
      p.logo_url,
      p.primary_color,
      p.text_color,
      p.goal_count,
      p.reward_text,
      p.promo_text,
      p.stamp_icon,
      case when p.program_type='stamps' then null else p.central_image_url end as central_image_url,
      p.service_name,
      p.validity_days,
      p.access_mode,
      'staff'::text as access_role
    from public.rewards_loyalty_programs p
    join public.rewards_program_staff s on s.program_id=p.id
    where s.status='active'
      and (
        s.user_id=auth.uid()
        or lower(s.email)=lower(coalesce(auth.jwt()->>'email',''))
      )
      and not exists(select 1 from owned o where o.id=p.id)
  )
  select * from owned
  union all
  select * from staff
  order by program_name;
$$;

grant execute on function public.rewards_scan_programs() to authenticated;
