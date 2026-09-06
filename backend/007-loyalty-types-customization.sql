-- rewards.enla · Más tipos de loyalty y personalización
-- Ejecuta una sola vez después de 006A.

alter table public.rewards_loyalty_programs drop constraint if exists rewards_loyalty_programs_program_type_check;
alter table public.rewards_loyalty_programs add constraint rewards_loyalty_programs_program_type_check check (program_type in ('stamps','points','visits'));
alter table public.rewards_loyalty_programs add column if not exists increment_value numeric not null default 1;
alter table public.rewards_loyalty_programs add column if not exists secondary_color text not null default '#7457f7';
alter table public.rewards_loyalty_programs add column if not exists card_style text not null default 'classic';
alter table public.rewards_loyalty_programs add column if not exists central_image_url text;
alter table public.rewards_loyalty_programs drop constraint if exists rewards_loyalty_programs_card_style_check;
alter table public.rewards_loyalty_programs add constraint rewards_loyalty_programs_card_style_check check (card_style in ('classic','promo','minimal'));

alter table public.rewards_loyalty_transactions drop constraint if exists rewards_loyalty_transactions_type_check;
alter table public.rewards_loyalty_transactions add constraint rewards_loyalty_transactions_type_check check(type in ('stamp','points','visit','redeem','adjustment'));

-- Reemplaza RPC de progreso: sellos/visitas suman 1; puntos suman increment_value.
create or replace function public.rewards_add_stamp(p_customer_id uuid)
returns table(public_code text, current_value numeric, goal_count integer, reward_ready boolean)
language plpgsql security definer set search_path=public as $$
declare
  v_customer public.rewards_customers%rowtype;
  v_goal integer; v_new_value numeric; v_type text; v_increment numeric; v_tx_type text; v_note text;
begin
  select c.* into v_customer from public.rewards_customers c join public.rewards_businesses b on b.id=c.business_id where c.id=p_customer_id and b.owner_id=auth.uid() for update of c;
  if not found then raise exception 'Cliente no encontrado o sin permiso.'; end if;
  select coalesce(p.goal_count,6),coalesce(p.program_type,'stamps'),coalesce(p.increment_value,1) into v_goal,v_type,v_increment from public.rewards_loyalty_programs p where p.id=v_customer.program_id;
  v_goal:=coalesce(v_goal,6); v_increment:=case when v_type='points' then greatest(1,v_increment) else 1 end;
  if v_customer.current_value >= v_goal then raise exception 'La recompensa ya está lista. Canjéala antes de agregar más progreso.'; end if;
  update public.rewards_customers rc set current_value=least(v_goal,rc.current_value+v_increment) where rc.id=p_customer_id returning rc.current_value into v_new_value;
  v_tx_type:=case v_type when 'points' then 'points' when 'visits' then 'visit' else 'stamp' end;
  v_note:=case v_type when 'points' then v_increment||' puntos agregados' when 'visits' then 'Visita registrada' else 'Sello agregado' end;
  insert into public.rewards_loyalty_transactions(business_id,program_id,customer_id,type,amount,note,created_by) values(v_customer.business_id,v_customer.program_id,v_customer.id,v_tx_type,v_increment,v_note,auth.uid());
  return query select v_customer.public_code,v_new_value,v_goal,(v_new_value>=v_goal);
end;$$;
grant execute on function public.rewards_add_stamp(uuid) to authenticated;

-- Los RPC públicos cambian su estructura: hay que recrearlos.
drop function if exists public.rewards_public_program(text);
create function public.rewards_public_program(p_slug text)
returns table(business_name text, slug text, program_id uuid, program_name text, display_name text, program_type text, goal_count integer, increment_value numeric, reward_text text, promo_text text, primary_color text, secondary_color text, card_style text, stamp_icon text, logo_url text, central_image_url text)
language sql security definer set search_path=public stable as $$
 select b.business_name,b.slug,p.id,p.program_name,p.display_name,p.program_type,p.goal_count,p.increment_value,p.reward_text,p.promo_text,p.primary_color,p.secondary_color,p.card_style,p.stamp_icon,p.logo_url,p.central_image_url
 from public.rewards_businesses b join public.rewards_loyalty_programs p on p.business_id=b.id where b.slug=p_slug and p.status='active' limit 1;
$$;
grant execute on function public.rewards_public_program(text) to anon,authenticated;

drop function if exists public.rewards_public_card(text);
create function public.rewards_public_card(p_code text)
returns table(public_code text, customer_name text, current_value numeric, business_name text, program_name text, display_name text, program_type text, goal_count integer, increment_value numeric, reward_text text, promo_text text, primary_color text, secondary_color text, card_style text, stamp_icon text, logo_url text, central_image_url text, apple_enabled boolean, google_enabled boolean)
language sql security definer set search_path=public stable as $$
 select c.public_code,c.name,c.current_value,b.business_name,p.program_name,p.display_name,p.program_type,p.goal_count,p.increment_value,p.reward_text,p.promo_text,p.primary_color,p.secondary_color,p.card_style,p.stamp_icon,p.logo_url,p.central_image_url,p.apple_enabled,p.google_enabled
 from public.rewards_customers c join public.rewards_businesses b on b.id=c.business_id left join public.rewards_loyalty_programs p on p.id=c.program_id where c.public_code=upper(p_code) limit 1;
$$;
grant execute on function public.rewards_public_card(text) to anon,authenticated;
