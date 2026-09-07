-- 014B · Corrige ambigüedad current_value en acciones de empleados.
-- Ejecutar después de 014A-fix-staff-login-and-scan.sql.

create or replace function public.rewards_staff_scan_action(
  p_customer_id uuid,
  p_action text,
  p_amount numeric default null
)
returns table(
  public_code text,
  current_value numeric,
  status text,
  expires_at timestamptz,
  last_access_state text,
  dynamic_code text
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_customer public.rewards_customers%rowtype;
  v_program public.rewards_loyalty_programs%rowtype;
  v_action text := lower(coalesce(p_action,''));
  v_amount numeric := coalesce(p_amount,0);
  v_new_code text;
  v_tx_type text;
  v_tx_amount numeric := 1;
begin
  select c.*
    into v_customer
    from public.rewards_customers c
   where c.id=p_customer_id
   for update;

  if not found then
    raise exception 'Cliente no encontrado.';
  end if;

  if not public.rewards_is_program_staff(v_customer.program_id) then
    raise exception 'Este empleado no tiene permiso para esta tarjeta.';
  end if;

  select p.*
    into v_program
    from public.rewards_loyalty_programs p
   where p.id=v_customer.program_id;

  if v_customer.status<>'active' then
    raise exception 'Tarjeta suspendida.';
  end if;

  if v_program.program_type='stamps' and v_action='stamp' then
    if coalesce(v_customer.current_value,0) >= coalesce(v_program.goal_count,0) then
      raise exception 'La tarjeta ya completó todos sus sellos.';
    end if;

    update public.rewards_customers rc
       set current_value=least(coalesce(v_program.goal_count,0),coalesce(rc.current_value,0)+1)
     where rc.id=v_customer.id
     returning rc.* into v_customer;
    v_tx_type:='stamp';
    v_tx_amount:=1;

  elsif v_program.program_type='visits' and v_action='visit' then
    if coalesce(v_customer.current_value,0)<=0 then
      raise exception 'No quedan visitas.';
    end if;

    update public.rewards_customers rc
       set current_value=greatest(0,coalesce(rc.current_value,0)-1)
     where rc.id=v_customer.id
     returning rc.* into v_customer;
    v_tx_type:='visit_use';
    v_tx_amount:=-1;

  elsif v_program.program_type='cashback' and v_action='cashback' then
    if v_amount<=0 then
      raise exception 'Monto inválido.';
    end if;

    update public.rewards_customers rc
       set current_value=round((coalesce(rc.current_value,0)+v_amount)::numeric,2)
     where rc.id=v_customer.id
     returning rc.* into v_customer;
    v_tx_type:='cashback';
    v_tx_amount:=v_amount;

  elsif v_program.program_type='access' and v_action in ('entry','in','out') then
    if v_customer.expires_at is null or v_customer.expires_at<now() then
      raise exception 'Credencial vencida.';
    end if;

    if v_program.access_mode='entry_exit' then
      update public.rewards_customers rc
         set last_access_state=case when v_action='out' then 'out' else 'in' end
       where rc.id=v_customer.id
       returning rc.* into v_customer;
      v_tx_type:=case when v_action='out' then 'access_out' else 'access_in' end;
    else
      v_tx_type:='access_entry';
    end if;
    v_tx_amount:=1;

  else
    raise exception 'Acción no permitida para esta tarjeta.';
  end if;

  -- El código dinámico solo aplica a Identificación / Acceso.
  if v_program.program_type='access' then
    v_new_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
    update public.rewards_customers rc
       set dynamic_code=v_new_code,
           dynamic_code_updated_at=now()
     where rc.id=v_customer.id
     returning rc.* into v_customer;
  end if;

  insert into public.rewards_loyalty_transactions(
    business_id,program_id,customer_id,type,amount,note,created_by
  ) values(
    v_customer.business_id,v_customer.program_id,v_customer.id,
    v_tx_type,v_tx_amount,'Registrado por empleado',auth.uid()
  );

  return query
  select
    v_customer.public_code,
    v_customer.current_value,
    v_customer.status,
    v_customer.expires_at,
    v_customer.last_access_state,
    v_customer.dynamic_code;
end$$;

grant execute on function public.rewards_staff_scan_action(uuid,text,numeric) to authenticated;
