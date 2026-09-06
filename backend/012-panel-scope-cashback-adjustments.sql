-- rewards.enla · Panel contextual + cashback abierto
-- Ejecutar DESPUÉS de 011-barcode-format.sql.

create or replace function public.rewards_add_cashback_amount(p_customer_id uuid,p_amount numeric)
returns table(public_code text,current_value numeric,amount_added numeric)
language plpgsql security definer set search_path=public as $$
declare
  v_customer public.rewards_customers%rowtype;
  v_type text; v_amount numeric; v_new numeric;
begin
  v_amount:=round(coalesce(p_amount,0)::numeric,2);
  if v_amount<=0 then raise exception 'La cantidad debe ser mayor a $0.'; end if;

  select c.* into v_customer from public.rewards_customers c
  join public.rewards_businesses b on b.id=c.business_id
  where c.id=p_customer_id and b.owner_id=auth.uid() for update of c;
  if not found then raise exception 'Cliente no encontrado o sin permiso.'; end if;
  if v_customer.status='inactive' then raise exception 'Esta tarjeta está desactivada.'; end if;

  select p.program_type into v_type from public.rewards_loyalty_programs p where p.id=v_customer.program_id;
  if v_type<>'cashback' then raise exception 'Esta tarjeta no es de cashback.'; end if;

  update public.rewards_customers rc
  set current_value=round((coalesce(rc.current_value,0)+v_amount)::numeric,2)
  where rc.id=p_customer_id returning rc.current_value into v_new;

  insert into public.rewards_loyalty_transactions(business_id,program_id,customer_id,type,amount,note,created_by)
  values(v_customer.business_id,v_customer.program_id,v_customer.id,'cashback',v_amount,'Saldo agregado: $'||to_char(v_amount,'FM999999990.00'),auth.uid());

  return query select v_customer.public_code,v_new,v_amount;
end; $$;
grant execute on function public.rewards_add_cashback_amount(uuid,numeric) to authenticated;

create or replace function public.rewards_set_cashback_balance(p_customer_id uuid,p_amount numeric)
returns table(public_code text,current_value numeric,previous_value numeric,adjustment numeric)
language plpgsql security definer set search_path=public as $$
declare
  v_customer public.rewards_customers%rowtype;
  v_type text; v_amount numeric; v_old numeric; v_delta numeric;
begin
  v_amount:=round(coalesce(p_amount,0)::numeric,2);
  if v_amount<0 then raise exception 'El saldo no puede ser negativo.'; end if;

  select c.* into v_customer from public.rewards_customers c
  join public.rewards_businesses b on b.id=c.business_id
  where c.id=p_customer_id and b.owner_id=auth.uid() for update of c;
  if not found then raise exception 'Cliente no encontrado o sin permiso.'; end if;

  select p.program_type into v_type from public.rewards_loyalty_programs p where p.id=v_customer.program_id;
  if v_type<>'cashback' then raise exception 'Esta tarjeta no es de cashback.'; end if;

  v_old:=round(coalesce(v_customer.current_value,0)::numeric,2);
  v_delta:=round((v_amount-v_old)::numeric,2);
  update public.rewards_customers rc set current_value=v_amount where rc.id=p_customer_id;

  if v_delta<>0 then
    insert into public.rewards_loyalty_transactions(business_id,program_id,customer_id,type,amount,note,created_by)
    values(v_customer.business_id,v_customer.program_id,v_customer.id,'adjustment',v_delta,
      'Corrección de saldo: $'||to_char(v_old,'FM999999990.00')||' → $'||to_char(v_amount,'FM999999990.00'),auth.uid());
  end if;

  return query select v_customer.public_code,v_amount,v_old,v_delta;
end; $$;
grant execute on function public.rewards_set_cashback_balance(uuid,numeric) to authenticated;
