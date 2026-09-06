-- rewards.enla · Puntos -> Cashback
-- Ejecutar DESPUÉS de 007-loyalty-types-customization.sql.

-- Convierte programas antiguos de puntos a cashback.
alter table public.rewards_loyalty_programs drop constraint if exists rewards_loyalty_programs_program_type_check;
update public.rewards_loyalty_programs set program_type='cashback' where program_type='points';
alter table public.rewards_loyalty_programs add constraint rewards_loyalty_programs_program_type_check
  check (program_type in ('stamps','cashback','visits'));

alter table public.rewards_loyalty_transactions drop constraint if exists rewards_loyalty_transactions_type_check;
-- Conserva historial viejo de puntos como cashback.
update public.rewards_loyalty_transactions set type='cashback' where type='points';
alter table public.rewards_loyalty_transactions add constraint rewards_loyalty_transactions_type_check
  check(type in ('stamp','cashback','visit','spend','redeem','adjustment'));

create or replace function public.rewards_add_stamp(p_customer_id uuid)
returns table(public_code text, current_value numeric, goal_count integer, reward_ready boolean)
language plpgsql security definer set search_path=public as $$
declare
  v_customer public.rewards_customers%rowtype;
  v_goal integer; v_type text; v_increment numeric; v_new_value numeric; v_tx_type text; v_note text;
begin
  select c.* into v_customer from public.rewards_customers c
  join public.rewards_businesses b on b.id=c.business_id
  where c.id=p_customer_id and b.owner_id=auth.uid() for update of c;
  if not found then raise exception 'Cliente no encontrado o sin permiso.'; end if;

  select coalesce(p.goal_count,6),coalesce(p.program_type,'stamps'),coalesce(p.increment_value,1)
  into v_goal,v_type,v_increment from public.rewards_loyalty_programs p where p.id=v_customer.program_id;
  v_goal:=coalesce(v_goal,6);
  v_increment:=case when v_type='cashback' then greatest(0.01,v_increment) else 1 end;

  if v_type<>'cashback' and v_customer.current_value>=v_goal then
    raise exception 'La recompensa ya está lista. Canjéala antes de agregar más progreso.';
  end if;

  update public.rewards_customers rc
  set current_value=case when v_type='cashback' then round((rc.current_value+v_increment)::numeric,2) else least(v_goal,rc.current_value+v_increment) end
  where rc.id=p_customer_id returning rc.current_value into v_new_value;

  v_tx_type:=case v_type when 'cashback' then 'cashback' when 'visits' then 'visit' else 'stamp' end;
  v_note:=case v_type when 'cashback' then '$'||to_char(v_increment,'FM999999990.00')||' de cashback agregado' when 'visits' then 'Visita registrada' else 'Sello agregado' end;
  insert into public.rewards_loyalty_transactions(business_id,program_id,customer_id,type,amount,note,created_by)
  values(v_customer.business_id,v_customer.program_id,v_customer.id,v_tx_type,v_increment,v_note,auth.uid());

  return query select v_customer.public_code,v_new_value,v_goal,(v_type<>'cashback' and v_new_value>=v_goal);
end; $$;
grant execute on function public.rewards_add_stamp(uuid) to authenticated;

create or replace function public.rewards_spend_cashback(p_customer_id uuid,p_amount numeric)
returns table(public_code text,current_value numeric,amount_spent numeric)
language plpgsql security definer set search_path=public as $$
declare
  v_customer public.rewards_customers%rowtype; v_type text; v_amount numeric; v_new numeric;
begin
  v_amount:=round(coalesce(p_amount,0)::numeric,2);
  if v_amount<=0 then raise exception 'La cantidad debe ser mayor a $0.'; end if;
  select c.* into v_customer from public.rewards_customers c
  join public.rewards_businesses b on b.id=c.business_id
  where c.id=p_customer_id and b.owner_id=auth.uid() for update of c;
  if not found then raise exception 'Cliente no encontrado o sin permiso.'; end if;
  select p.program_type into v_type from public.rewards_loyalty_programs p where p.id=v_customer.program_id;
  if v_type<>'cashback' then raise exception 'Este programa no es de cashback.'; end if;
  if v_amount>v_customer.current_value then raise exception 'Saldo insuficiente. Disponible: $%',to_char(v_customer.current_value,'FM999999990.00'); end if;
  update public.rewards_customers rc set current_value=round((rc.current_value-v_amount)::numeric,2)
  where rc.id=p_customer_id returning rc.current_value into v_new;
  insert into public.rewards_loyalty_transactions(business_id,program_id,customer_id,type,amount,note,created_by)
  values(v_customer.business_id,v_customer.program_id,v_customer.id,'spend',v_amount,'Saldo utilizado: $'||to_char(v_amount,'FM999999990.00'),auth.uid());
  return query select v_customer.public_code,v_new,v_amount;
end; $$;
grant execute on function public.rewards_spend_cashback(uuid,numeric) to authenticated;

-- Evita usar el canje tradicional en tarjetas cashback.
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
  if v_customer.current_value<v_goal then raise exception 'Este cliente todavía no completa la meta para canjear.'; end if;
  update public.rewards_customers rc set current_value=0 where rc.id=p_customer_id;
  insert into public.rewards_loyalty_transactions(business_id,program_id,customer_id,type,amount,note,created_by)
  values(v_customer.business_id,v_customer.program_id,v_customer.id,'redeem',v_goal,'Canje: '||v_reward,auth.uid());
  return query select v_customer.public_code,0::numeric,v_goal,v_reward;
end; $$;
grant execute on function public.rewards_redeem_reward(uuid) to authenticated;
