-- Ejecuta este archivo UNA sola vez en Supabase > SQL Editor.
-- Habilita el alta pública por QR sin abrir las tablas con RLS.

create or replace function public.rewards_public_program(p_slug text)
returns table(business_name text, slug text, program_id uuid, program_name text, display_name text, program_type text, goal_count integer, reward_text text, promo_text text, primary_color text, stamp_icon text, logo_url text)
language sql security definer set search_path=public stable as $$
  select b.business_name,b.slug,p.id,p.program_name,p.display_name,p.program_type,p.goal_count,p.reward_text,p.promo_text,p.primary_color,p.stamp_icon,p.logo_url
  from public.rewards_businesses b join public.rewards_loyalty_programs p on p.business_id=b.id
  where b.slug=p_slug and p.status='active' limit 1;
$$;

grant execute on function public.rewards_public_program(text) to anon, authenticated;

create or replace function public.rewards_join_program(p_slug text,p_name text,p_email text default null,p_phone text default null)
returns table(public_code text, customer_name text)
language plpgsql security definer set search_path=public as $$
declare v_business uuid; v_program uuid; v_code text; v_name text;
begin
  if length(trim(coalesce(p_name,''))) < 2 then raise exception 'Escribe tu nombre.'; end if;
  select b.id,p.id into v_business,v_program from public.rewards_businesses b join public.rewards_loyalty_programs p on p.business_id=b.id where b.slug=p_slug and p.status='active' limit 1;
  if v_business is null then raise exception 'Este programa no existe o no está activo.'; end if;
  if nullif(trim(coalesce(p_email,'')),'') is null and nullif(trim(coalesce(p_phone,'')),'') is null then raise exception 'Agrega correo o teléfono.'; end if;
  -- Si ya existe el mismo contacto en este negocio, devuelve su tarjeta en vez de duplicarlo.
  select c.public_code,c.name into v_code,v_name from public.rewards_customers c where c.business_id=v_business and ((nullif(lower(trim(coalesce(p_email,''))),'') is not null and lower(c.email)=lower(trim(p_email))) or (nullif(trim(coalesce(p_phone,'')),'') is not null and c.phone=trim(p_phone))) order by c.created_at desc limit 1;
  if v_code is null then
    insert into public.rewards_customers(business_id,program_id,name,email,phone,current_value)
    values(v_business,v_program,trim(p_name),nullif(lower(trim(coalesce(p_email,''))),''),nullif(trim(coalesce(p_phone,'')),''),0)
    returning rewards_customers.public_code,rewards_customers.name into v_code,v_name;
  end if;
  return query select v_code,v_name;
end;$$;

grant execute on function public.rewards_join_program(text,text,text,text) to anon, authenticated;

create or replace function public.rewards_public_card(p_code text)
returns table(public_code text, customer_name text, current_value numeric, business_name text, program_name text, display_name text, program_type text, goal_count integer, reward_text text, promo_text text, primary_color text, stamp_icon text, logo_url text)
language sql security definer set search_path=public stable as $$
 select c.public_code,c.name,c.current_value,b.business_name,p.program_name,p.display_name,p.program_type,p.goal_count,p.reward_text,p.promo_text,p.primary_color,p.stamp_icon,p.logo_url
 from public.rewards_customers c join public.rewards_businesses b on b.id=c.business_id left join public.rewards_loyalty_programs p on p.id=c.program_id
 where c.public_code=upper(p_code) limit 1;
$$;

grant execute on function public.rewards_public_card(text) to anon, authenticated;
