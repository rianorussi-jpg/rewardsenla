-- 009 · Múltiples tarjetas por negocio + tipo inmutable + registro público por tarjeta

-- Permitir varias tarjetas por negocio.
do $$
declare r record;
begin
  for r in select conname from pg_constraint where conrelid='public.rewards_loyalty_programs'::regclass and contype='u' loop
    if pg_get_constraintdef((select oid from pg_constraint where conname=r.conname and conrelid='public.rewards_loyalty_programs'::regclass)) ilike '%business_id%' then
      execute format('alter table public.rewards_loyalty_programs drop constraint %I',r.conname);
    end if;
  end loop;
end $$;

alter table public.rewards_loyalty_programs add column if not exists public_slug text;
update public.rewards_loyalty_programs set public_slug=lower(substr(replace(id::text,'-',''),1,12)) where public_slug is null;
alter table public.rewards_loyalty_programs alter column public_slug set not null;
create unique index if not exists rewards_loyalty_programs_public_slug_uidx on public.rewards_loyalty_programs(public_slug);

-- Bloquear cambios de tipo una vez creada la tarjeta.
create or replace function public.rewards_lock_program_type() returns trigger language plpgsql as $$
begin
  if old.program_type is distinct from new.program_type then
    raise exception 'El tipo de tarjeta no se puede cambiar después de crearla.';
  end if;
  return new;
end;$$;
drop trigger if exists rewards_lock_program_type_trigger on public.rewards_loyalty_programs;
create trigger rewards_lock_program_type_trigger before update on public.rewards_loyalty_programs for each row execute function public.rewards_lock_program_type();

-- Datos públicos de UNA tarjeta concreta.
drop function if exists public.rewards_public_program_card(text);
create function public.rewards_public_program_card(p_program_slug text)
returns table(business_name text, program_id uuid, public_slug text, program_name text, display_name text, program_type text, goal_count integer, increment_value numeric, reward_text text, promo_text text, primary_color text, secondary_color text, card_style text, stamp_icon text, logo_url text, central_image_url text)
language sql security definer set search_path=public stable as $$
 select b.business_name,p.id,p.public_slug,p.program_name,p.display_name,p.program_type,p.goal_count,p.increment_value,p.reward_text,p.promo_text,p.primary_color,p.secondary_color,p.card_style,p.stamp_icon,p.logo_url,p.central_image_url
 from public.rewards_loyalty_programs p join public.rewards_businesses b on b.id=p.business_id
 where (p.public_slug=p_program_slug or p.id::text=p_program_slug) and p.status='active' limit 1;
$$;
grant execute on function public.rewards_public_program_card(text) to anon,authenticated;

drop function if exists public.rewards_join_program_card(text,text,text,text);
create function public.rewards_join_program_card(p_program_slug text,p_name text,p_email text default null,p_phone text default null)
returns table(public_code text, customer_name text)
language plpgsql security definer set search_path=public as $$
declare v_business uuid;v_program uuid;v_code text;v_name text;
begin
 if length(trim(coalesce(p_name,'')))<2 then raise exception 'Escribe tu nombre.'; end if;
 select p.business_id,p.id into v_business,v_program from public.rewards_loyalty_programs p where (p.public_slug=p_program_slug or p.id::text=p_program_slug) and p.status='active' limit 1;
 if v_program is null then raise exception 'Esta tarjeta no existe o no está activa.'; end if;
 if nullif(trim(coalesce(p_email,'')),'') is null and nullif(trim(coalesce(p_phone,'')),'') is null then raise exception 'Agrega correo o teléfono.'; end if;
 select c.public_code,c.name into v_code,v_name from public.rewards_customers c where c.program_id=v_program and ((nullif(lower(trim(coalesce(p_email,''))),'') is not null and lower(c.email)=lower(trim(p_email))) or (nullif(trim(coalesce(p_phone,'')),'') is not null and c.phone=trim(p_phone))) order by c.created_at desc limit 1;
 if v_code is null then
   insert into public.rewards_customers(business_id,program_id,name,email,phone,current_value) values(v_business,v_program,trim(p_name),nullif(lower(trim(coalesce(p_email,''))),''),nullif(trim(coalesce(p_phone,'')),''),0) returning rewards_customers.public_code,rewards_customers.name into v_code,v_name;
 end if;
 return query select v_code,v_name;
end;$$;
grant execute on function public.rewards_join_program_card(text,text,text,text) to anon,authenticated;
