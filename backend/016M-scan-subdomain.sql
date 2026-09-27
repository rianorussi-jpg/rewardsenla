-- Enla Cards · 016M · Scan subdomain
-- Ejecutar después de 014B (y del esquema actual del proyecto).
--
-- Crea una consola operativa segura para scan.enlacards.com:
-- - dueños y empleados ven sólo las tarjetas a las que tienen acceso;
-- - búsqueda de clientes por código, correo o nombre dentro de la tarjeta elegida;
-- - acciones operativas unificadas para sellos, cashback, visitas y acceso.

create or replace function public.rewards_scan_has_program_access(p_program uuid)
returns boolean
language sql
security definer
stable
set search_path=public
as $$
  select exists(
    select 1
    from public.rewards_loyalty_programs p
    join public.rewards_businesses b on b.id=p.business_id
    where p.id=p_program
      and b.owner_id=auth.uid()
  )
  or exists(
    select 1
    from public.rewards_program_staff s
    where s.program_id=p_program
      and s.status='active'
      and (
        s.user_id=auth.uid()
        or lower(s.email)=lower(coalesce(auth.jwt()->>'email',''))
      )
  );
$$;
grant execute on function public.rewards_scan_has_program_access(uuid) to authenticated;


create or replace function public.rewards_scan_programs()
returns table(
  id uuid,
  program_name text,
  display_name text,
  program_type text,
  logo_url text,
  primary_color text,
  goal_count integer,
  reward_text text,
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
      p.id,p.program_name,p.display_name,p.program_type,p.logo_url,p.primary_color,
      p.goal_count,p.reward_text,p.service_name,p.validity_days,p.access_mode,
      'owner'::text as access_role
    from public.rewards_loyalty_programs p
    join public.rewards_businesses b on b.id=p.business_id
    where b.owner_id=auth.uid()
  ),
  staff as (
    select
      p.id,p.program_name,p.display_name,p.program_type,p.logo_url,p.primary_color,
      p.goal_count,p.reward_text,p.service_name,p.validity_days,p.access_mode,
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


create or replace function public.rewards_scan_search(
  p_program_id uuid,
  p_query text
)
returns table(
  id uuid,
  program_id uuid,
  name text,
  email text,
  public_code text,
  dynamic_code text,
  current_value numeric,
  status text,
  photo_url text,
  expires_at timestamptz,
  last_access_state text
)
language plpgsql
security definer
stable
set search_path=public
as $$
declare
  q text := trim(coalesce(p_query,''));
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión.';
  end if;

  if not public.rewards_scan_has_program_access(p_program_id) then
    raise exception 'No tienes acceso a esta tarjeta.';
  end if;

  if q='' then
    return;
  end if;

  return query
  select
    c.id,c.program_id,c.name,c.email,c.public_code,c.dynamic_code,
    c.current_value,c.status,c.photo_url,c.expires_at,c.last_access_state
  from public.rewards_customers c
  where c.program_id=p_program_id
    and (
      upper(c.public_code)=upper(q)
      or upper(coalesce(c.dynamic_code,''))=upper(q)
      or c.name ilike '%'||q||'%'
      or coalesce(c.email,'') ilike '%'||q||'%'
    )
  order by
    case when upper(c.public_code)=upper(q) or upper(coalesce(c.dynamic_code,''))=upper(q) then 0 else 1 end,
    case when lower(coalesce(c.email,''))=lower(q) then 0 else 1 end,
    c.name
  limit 30;
end;
$$;
grant execute on function public.rewards_scan_search(uuid,text) to authenticated;


create or replace function public.rewards_scan_console_action(
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
  c public.rewards_customers%rowtype;
  p public.rewards_loyalty_programs%rowtype;
  a text := lower(trim(coalesce(p_action,'')));
  amt numeric := round(coalesce(p_amount,0)::numeric,2);
  new_code text;
  tx_type text;
  tx_amount numeric := 0;
  tx_note text;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión.';
  end if;

  select c0.* into c
  from public.rewards_customers c0
  where c0.id=p_customer_id
  for update;

  if not found then
    raise exception 'Cliente no encontrado.';
  end if;

  if not public.rewards_scan_has_program_access(c.program_id) then
    raise exception 'No tienes permiso para operar esta tarjeta.';
  end if;

  select p0.* into p
  from public.rewards_loyalty_programs p0
  where p0.id=c.program_id;

  if c.status<>'active' then
    raise exception 'Esta tarjeta está suspendida.';
  end if;

  -- SELLOS
  if p.program_type='stamps' and a='add_stamp' then
    if coalesce(c.current_value,0)>=coalesce(p.goal_count,1) then
      raise exception 'La recompensa ya está lista. Canjéala antes de agregar otro sello.';
    end if;

    update public.rewards_customers rc
      set current_value=least(coalesce(p.goal_count,1),coalesce(rc.current_value,0)+1)
      where rc.id=c.id
      returning rc.* into c;

    tx_type:='stamp'; tx_amount:=1; tx_note:='Sello agregado desde Enla Cards Scan';

  elsif p.program_type='stamps' and a='remove_stamp' then
    if coalesce(c.current_value,0)<=0 then
      raise exception 'No hay sellos para quitar.';
    end if;

    update public.rewards_customers rc
      set current_value=greatest(0,coalesce(rc.current_value,0)-1)
      where rc.id=c.id
      returning rc.* into c;

    tx_type:='adjustment'; tx_amount:=-1; tx_note:='Sello retirado desde Enla Cards Scan';

  elsif p.program_type='stamps' and a='redeem' then
    if coalesce(c.current_value,0)<coalesce(p.goal_count,1) then
      raise exception 'El cliente todavía no completa la meta.';
    end if;

    update public.rewards_customers rc
      set current_value=0
      where rc.id=c.id
      returning rc.* into c;

    tx_type:='redeem'; tx_amount:=coalesce(p.goal_count,1);
    tx_note:='Canje desde Enla Cards Scan: '||coalesce(p.reward_text,'Recompensa');

  -- CASHBACK
  elsif p.program_type='cashback' and a='add_cashback' then
    if amt<=0 then raise exception 'Escribe un monto mayor a $0.'; end if;

    update public.rewards_customers rc
      set current_value=round((coalesce(rc.current_value,0)+amt)::numeric,2)
      where rc.id=c.id
      returning rc.* into c;

    tx_type:='cashback'; tx_amount:=amt;
    tx_note:='Cashback agregado desde Enla Cards Scan: $'||to_char(amt,'FM999999990.00');

  elsif p.program_type='cashback' and a='remove_cashback' then
    if amt<=0 then raise exception 'Escribe un monto mayor a $0.'; end if;
    if amt>coalesce(c.current_value,0) then
      raise exception 'Saldo insuficiente. Disponible: $%',to_char(coalesce(c.current_value,0),'FM999999990.00');
    end if;

    update public.rewards_customers rc
      set current_value=round((coalesce(rc.current_value,0)-amt)::numeric,2)
      where rc.id=c.id
      returning rc.* into c;

    tx_type:='spend'; tx_amount:=amt;
    tx_note:='Saldo utilizado desde Enla Cards Scan: $'||to_char(amt,'FM999999990.00');

  -- VISITAS
  elsif p.program_type='visits' and a='use_visit' then
    if coalesce(c.current_value,0)<=0 then raise exception 'No quedan visitas.'; end if;

    update public.rewards_customers rc
      set current_value=greatest(0,coalesce(rc.current_value,0)-1)
      where rc.id=c.id
      returning rc.* into c;

    tx_type:='visit_use'; tx_amount:=-1; tx_note:='Visita utilizada desde Enla Cards Scan';

  elsif p.program_type='visits' and a='add_visit' then
    update public.rewards_customers rc
      set current_value=least(coalesce(p.goal_count,999999),coalesce(rc.current_value,0)+1)
      where rc.id=c.id
      returning rc.* into c;

    tx_type:='adjustment'; tx_amount:=1; tx_note:='Visita devuelta desde Enla Cards Scan';

  -- IDENTIFICACIÓN / ACCESO
  elsif p.program_type='access' and a in ('access_entry','access_in','access_out') then
    if c.expires_at is null or c.expires_at<now() then
      raise exception 'Esta credencial está vencida.';
    end if;

    if p.access_mode='entry_exit' then
      update public.rewards_customers rc
        set last_access_state=case when a='access_out' then 'out' else 'in' end
        where rc.id=c.id
        returning rc.* into c;

      tx_type:=case when a='access_out' then 'access_out' else 'access_in' end;
      tx_note:=case when a='access_out' then 'Salida registrada desde Enla Cards Scan'
                    else 'Entrada registrada desde Enla Cards Scan' end;
    else
      tx_type:='access_entry';
      tx_note:='Acceso registrado desde Enla Cards Scan';
    end if;

    tx_amount:=1;

    new_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
    update public.rewards_customers rc
      set dynamic_code=new_code,
          dynamic_code_updated_at=now()
      where rc.id=c.id
      returning rc.* into c;

  else
    raise exception 'Acción no permitida para este tipo de tarjeta.';
  end if;

  insert into public.rewards_loyalty_transactions(
    business_id,program_id,customer_id,type,amount,note,created_by
  ) values(
    c.business_id,c.program_id,c.id,tx_type,tx_amount,tx_note,auth.uid()
  );

  return query
  select c.public_code,c.current_value,c.status,c.expires_at,c.last_access_state,c.dynamic_code;
end;
$$;
grant execute on function public.rewards_scan_console_action(uuid,text,numeric) to authenticated;
