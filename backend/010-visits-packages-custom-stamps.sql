-- 010 · Visitas como paquete + iconos personalizados para sellos
-- Ejecutar después de 009B.

alter table public.rewards_loyalty_programs
  add column if not exists stamp_filled_image_url text,
  add column if not exists stamp_empty_image_url text;

alter table public.rewards_customers
  add column if not exists status text not null default 'active';

alter table public.rewards_customers drop constraint if exists rewards_customers_status_check;
alter table public.rewards_customers add constraint rewards_customers_status_check
  check (status in ('active','inactive'));

-- Visitas puede ser un paquete desde 1 visita; cashback sigue sin meta.
alter table public.rewards_loyalty_programs drop constraint if exists rewards_loyalty_programs_goal_count_check;
alter table public.rewards_loyalty_programs add constraint rewards_loyalty_programs_goal_count_check
  check (
    (program_type='cashback' and goal_count=0)
    or (program_type='stamps' and goal_count between 2 and 1000)
    or (program_type='visits' and goal_count between 1 and 1000)
  );

alter table public.rewards_loyalty_transactions drop constraint if exists rewards_loyalty_transactions_type_check;
alter table public.rewards_loyalty_transactions add constraint rewards_loyalty_transactions_type_check
  check(type in ('stamp','cashback','visit','visit_use','visit_renew','deactivate','spend','redeem','adjustment'));

-- Datos públicos de una tarjeta/programa.
drop function if exists public.rewards_public_program_card(text);
create function public.rewards_public_program_card(p_program_slug text)
returns table(
  business_name text, program_id uuid, public_slug text, program_name text, display_name text,
  program_type text, goal_count integer, increment_value numeric, reward_text text, promo_text text,
  primary_color text, secondary_color text, card_style text, stamp_icon text,
  stamp_filled_image_url text, stamp_empty_image_url text,
  logo_url text, central_image_url text
)
language sql security definer set search_path=public stable as $$
  select b.business_name,p.id,p.public_slug,p.program_name,p.display_name,p.program_type,p.goal_count,
         p.increment_value,p.reward_text,p.promo_text,p.primary_color,p.secondary_color,p.card_style,
         p.stamp_icon,p.stamp_filled_image_url,p.stamp_empty_image_url,p.logo_url,
         case when p.program_type='stamps' then null else p.central_image_url end
  from public.rewards_loyalty_programs p
  join public.rewards_businesses b on b.id=p.business_id
  where (p.public_slug=p_program_slug or p.id::text=p_program_slug) and p.status='active'
  limit 1;
$$;
grant execute on function public.rewards_public_program_card(text) to anon,authenticated;

-- Alta pública: en visitas el cliente comienza con TODO el paquete disponible.
drop function if exists public.rewards_join_program_card(text,text,text,text);
create function public.rewards_join_program_card(p_program_slug text,p_name text,p_email text default null,p_phone text default null)
returns table(public_code text, customer_name text)
language plpgsql security definer set search_path=public as $$
declare
  v_business uuid; v_program uuid; v_code text; v_name text; v_type text; v_goal integer; v_initial numeric:=0;
begin
  if length(trim(coalesce(p_name,'')))<2 then raise exception 'Escribe tu nombre.'; end if;
  select p.business_id,p.id,p.program_type,p.goal_count
    into v_business,v_program,v_type,v_goal
  from public.rewards_loyalty_programs p
  where (p.public_slug=p_program_slug or p.id::text=p_program_slug) and p.status='active' limit 1;
  if v_program is null then raise exception 'Esta tarjeta no existe o no está activa.'; end if;
  if nullif(trim(coalesce(p_email,'')),'') is null and nullif(trim(coalesce(p_phone,'')),'') is null then
    raise exception 'Agrega correo o teléfono.';
  end if;
  select c.public_code,c.name into v_code,v_name
  from public.rewards_customers c
  where c.program_id=v_program and (
    (nullif(lower(trim(coalesce(p_email,''))),'') is not null and lower(c.email)=lower(trim(p_email)))
    or (nullif(trim(coalesce(p_phone,'')),'') is not null and c.phone=trim(p_phone))
  ) order by c.created_at desc limit 1;
  if v_code is null then
    v_initial:=case when v_type='visits' then greatest(coalesce(v_goal,1),1) else 0 end;
    insert into public.rewards_customers(business_id,program_id,name,email,phone,current_value,status)
    values(v_business,v_program,trim(p_name),nullif(lower(trim(coalesce(p_email,''))),''),nullif(trim(coalesce(p_phone,'')),''),v_initial,'active')
    returning rewards_customers.public_code,rewards_customers.name into v_code,v_name;
  end if;
  return query select v_code,v_name;
end;$$;
grant execute on function public.rewards_join_program_card(text,text,text,text) to anon,authenticated;

-- Tarjeta pública completa.
drop function if exists public.rewards_public_card(text);
create function public.rewards_public_card(p_code text)
returns table(
  public_code text, customer_name text, current_value numeric, customer_status text,
  business_name text, program_name text, display_name text, program_type text, goal_count integer,
  increment_value numeric, reward_text text, promo_text text, primary_color text, secondary_color text,
  card_style text, stamp_icon text, stamp_filled_image_url text, stamp_empty_image_url text,
  logo_url text, central_image_url text, apple_enabled boolean, google_enabled boolean
)
language sql security definer set search_path=public stable as $$
  select c.public_code,c.name,c.current_value,c.status,b.business_name,p.program_name,p.display_name,
         p.program_type,p.goal_count,p.increment_value,p.reward_text,p.promo_text,p.primary_color,
         p.secondary_color,p.card_style,p.stamp_icon,p.stamp_filled_image_url,p.stamp_empty_image_url,
         p.logo_url,case when p.program_type='stamps' then null else p.central_image_url end,
         p.apple_enabled,p.google_enabled
  from public.rewards_customers c
  join public.rewards_businesses b on b.id=c.business_id
  left join public.rewards_loyalty_programs p on p.id=c.program_id
  where c.public_code=upper(p_code)
  limit 1;
$$;
grant execute on function public.rewards_public_card(text) to anon,authenticated;

-- Sellos/cashback conservan su comportamiento. Visitas se consumen con rewards_use_visit().
create or replace function public.rewards_add_stamp(p_customer_id uuid)
returns table(public_code text, current_value numeric, goal_count integer, reward_ready boolean)
language plpgsql security definer set search_path=public as $$
declare
  v_customer public.rewards_customers%rowtype;
  v_goal integer; v_type text; v_increment numeric; v_new numeric; v_tx_type text; v_note text;
begin
  select c.* into v_customer from public.rewards_customers c
  join public.rewards_businesses b on b.id=c.business_id
  where c.id=p_customer_id and b.owner_id=auth.uid() for update of c;
  if not found then raise exception 'Cliente no encontrado o sin permiso.'; end if;
  if v_customer.status='inactive' then raise exception 'Esta tarjeta está desactivada.'; end if;
  select coalesce(p.goal_count,6),coalesce(p.program_type,'stamps'),coalesce(p.increment_value,1)
    into v_goal,v_type,v_increment from public.rewards_loyalty_programs p where p.id=v_customer.program_id;
  if v_type='visits' then raise exception 'Esta tarjeta usa visitas restantes. Usa la acción Usar visita.'; end if;
  if v_type='stamps' and v_customer.current_value>=v_goal then
    raise exception 'La recompensa ya está lista. Canjéala antes de agregar más sellos.';
  end if;
  v_increment:=case when v_type='cashback' then greatest(0.01,v_increment) else 1 end;
  update public.rewards_customers rc
  set current_value=case when v_type='cashback' then round((rc.current_value+v_increment)::numeric,2) else least(v_goal,rc.current_value+1) end
  where rc.id=p_customer_id returning rc.current_value into v_new;
  v_tx_type:=case when v_type='cashback' then 'cashback' else 'stamp' end;
  v_note:=case when v_type='cashback' then '$'||to_char(v_increment,'FM999999990.00')||' de cashback agregado' else 'Sello agregado' end;
  insert into public.rewards_loyalty_transactions(business_id,program_id,customer_id,type,amount,note,created_by)
  values(v_customer.business_id,v_customer.program_id,v_customer.id,v_tx_type,v_increment,v_note,auth.uid());
  return query select v_customer.public_code,v_new,v_goal,(v_type='stamps' and v_new>=v_goal);
end;$$;
grant execute on function public.rewards_add_stamp(uuid) to authenticated;

create or replace function public.rewards_use_visit(p_customer_id uuid)
returns table(public_code text,current_value numeric,goal_count integer)
language plpgsql security definer set search_path=public as $$
declare v_customer public.rewards_customers%rowtype; v_type text; v_goal integer; v_new numeric;
begin
  select c.* into v_customer from public.rewards_customers c
  join public.rewards_businesses b on b.id=c.business_id
  where c.id=p_customer_id and b.owner_id=auth.uid() for update of c;
  if not found then raise exception 'Cliente no encontrado o sin permiso.'; end if;
  select p.program_type,p.goal_count into v_type,v_goal from public.rewards_loyalty_programs p where p.id=v_customer.program_id;
  if v_type<>'visits' then raise exception 'Esta tarjeta no es un paquete de visitas.'; end if;
  if v_customer.status='inactive' then raise exception 'Esta tarjeta está desactivada.'; end if;
  if v_customer.current_value<=0 then raise exception 'Este cliente ya no tiene visitas disponibles.'; end if;
  update public.rewards_customers rc set current_value=greatest(0,rc.current_value-1)
  where rc.id=p_customer_id returning rc.current_value into v_new;
  insert into public.rewards_loyalty_transactions(business_id,program_id,customer_id,type,amount,note,created_by)
  values(v_customer.business_id,v_customer.program_id,v_customer.id,'visit_use',1,'Visita utilizada',auth.uid());
  return query select v_customer.public_code,v_new,v_goal;
end;$$;
grant execute on function public.rewards_use_visit(uuid) to authenticated;

create or replace function public.rewards_renew_visits(p_customer_id uuid)
returns table(public_code text,current_value numeric,goal_count integer)
language plpgsql security definer set search_path=public as $$
declare v_customer public.rewards_customers%rowtype; v_type text; v_goal integer;
begin
  select c.* into v_customer from public.rewards_customers c
  join public.rewards_businesses b on b.id=c.business_id
  where c.id=p_customer_id and b.owner_id=auth.uid() for update of c;
  if not found then raise exception 'Cliente no encontrado o sin permiso.'; end if;
  select p.program_type,p.goal_count into v_type,v_goal from public.rewards_loyalty_programs p where p.id=v_customer.program_id;
  if v_type<>'visits' then raise exception 'Esta tarjeta no es de visitas.'; end if;
  v_goal:=greatest(coalesce(v_goal,1),1);
  update public.rewards_customers rc set current_value=v_goal,status='active' where rc.id=p_customer_id;
  insert into public.rewards_loyalty_transactions(business_id,program_id,customer_id,type,amount,note,created_by)
  values(v_customer.business_id,v_customer.program_id,v_customer.id,'visit_renew',v_goal,'Paquete renovado: '||v_goal||' visitas',auth.uid());
  return query select v_customer.public_code,v_goal::numeric,v_goal;
end;$$;
grant execute on function public.rewards_renew_visits(uuid) to authenticated;

create or replace function public.rewards_deactivate_visit_card(p_customer_id uuid)
returns table(public_code text,current_value numeric,status text)
language plpgsql security definer set search_path=public as $$
declare v_customer public.rewards_customers%rowtype; v_type text;
begin
  select c.* into v_customer from public.rewards_customers c
  join public.rewards_businesses b on b.id=c.business_id
  where c.id=p_customer_id and b.owner_id=auth.uid() for update of c;
  if not found then raise exception 'Cliente no encontrado o sin permiso.'; end if;
  select p.program_type into v_type from public.rewards_loyalty_programs p where p.id=v_customer.program_id;
  if v_type<>'visits' then raise exception 'Esta tarjeta no es de visitas.'; end if;
  update public.rewards_customers rc set status='inactive' where rc.id=p_customer_id;
  insert into public.rewards_loyalty_transactions(business_id,program_id,customer_id,type,amount,note,created_by)
  values(v_customer.business_id,v_customer.program_id,v_customer.id,'deactivate',0,'Tarjeta de visitas desactivada',auth.uid());
  return query select v_customer.public_code,v_customer.current_value,'inactive'::text;
end;$$;
grant execute on function public.rewards_deactivate_visit_card(uuid) to authenticated;

-- El canje tradicional solo aplica a sellos.
create or replace function public.rewards_redeem_reward(p_customer_id uuid)
returns table(public_code text,current_value numeric,goal_count integer,reward_text text)
language plpgsql security definer set search_path=public as $$
declare v_customer public.rewards_customers%rowtype; v_goal integer; v_reward text; v_type text;
begin
  select c.* into v_customer from public.rewards_customers c join public.rewards_businesses b on b.id=c.business_id
  where c.id=p_customer_id and b.owner_id=auth.uid() for update of c;
  if not found then raise exception 'Cliente no encontrado o sin permiso.'; end if;
  select coalesce(p.goal_count,6),coalesce(p.reward_text,'Recompensa'),p.program_type into v_goal,v_reward,v_type
  from public.rewards_loyalty_programs p where p.id=v_customer.program_id;
  if v_type='cashback' then raise exception 'En cashback usa la opción Usar saldo.'; end if;
  if v_type='visits' then raise exception 'Las tarjetas de visitas se renuevan o desactivan cuando llegan a 0.'; end if;
  if v_customer.current_value<v_goal then raise exception 'Este cliente todavía no completa la meta para canjear.'; end if;
  update public.rewards_customers rc set current_value=0 where rc.id=p_customer_id;
  insert into public.rewards_loyalty_transactions(business_id,program_id,customer_id,type,amount,note,created_by)
  values(v_customer.business_id,v_customer.program_id,v_customer.id,'redeem',v_goal,'Canje: '||v_reward,auth.uid());
  return query select v_customer.public_code,0::numeric,v_goal,v_reward;
end;$$;
grant execute on function public.rewards_redeem_reward(uuid) to authenticated;
