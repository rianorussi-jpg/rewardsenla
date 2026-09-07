-- 014 · Empleados por tarjeta + vigencia manual + identificación empleados/clientes + código dinámico
-- Ejecutar después de 013-identification-access.sql.

alter table public.rewards_loyalty_programs add column if not exists access_purpose text not null default 'customers';
alter table public.rewards_loyalty_programs drop constraint if exists rewards_loyalty_programs_access_purpose_check;
alter table public.rewards_loyalty_programs add constraint rewards_loyalty_programs_access_purpose_check check(access_purpose in ('customers','employees'));

alter table public.rewards_customers add column if not exists dynamic_code text;
alter table public.rewards_customers add column if not exists dynamic_code_updated_at timestamptz;
create unique index if not exists rewards_customers_dynamic_code_key on public.rewards_customers(dynamic_code) where dynamic_code is not null;
update public.rewards_customers set dynamic_code=upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),dynamic_code_updated_at=now() where dynamic_code is null;

create table if not exists public.rewards_program_staff(
 id uuid primary key default gen_random_uuid(), program_id uuid not null references public.rewards_loyalty_programs(id) on delete cascade,
 business_id uuid not null references public.rewards_businesses(id) on delete cascade,
 email text not null, user_id uuid references auth.users(id) on delete set null,
 status text not null default 'active' check(status in ('active','inactive')), created_at timestamptz not null default now(),
 unique(program_id,email)
);
alter table public.rewards_program_staff enable row level security;
drop policy if exists "program staff owner manage" on public.rewards_program_staff;
create policy "program staff owner manage" on public.rewards_program_staff for all using(business_id in(select id from public.rewards_businesses where owner_id=auth.uid())) with check(business_id in(select id from public.rewards_businesses where owner_id=auth.uid()));
drop policy if exists "program staff self read" on public.rewards_program_staff;
create policy "program staff self read" on public.rewards_program_staff for select using(lower(email)=lower(coalesce(auth.jwt()->>'email','')) or user_id=auth.uid());

create or replace function public.rewards_is_program_staff(p_program uuid) returns boolean language sql security definer stable set search_path=public as $$
 select exists(select 1 from public.rewards_program_staff s where s.program_id=p_program and s.status='active' and (s.user_id=auth.uid() or lower(s.email)=lower(coalesce(auth.jwt()->>'email','')))); $$;
grant execute on function public.rewards_is_program_staff(uuid) to authenticated;

create or replace function public.rewards_staff_programs() returns setof public.rewards_loyalty_programs language sql security definer stable set search_path=public as $$
 select p.* from public.rewards_loyalty_programs p join public.rewards_program_staff s on s.program_id=p.id where s.status='active' and (s.user_id=auth.uid() or lower(s.email)=lower(coalesce(auth.jwt()->>'email',''))); $$;
grant execute on function public.rewards_staff_programs() to authenticated;

create or replace function public.rewards_add_program_staff(p_program_id uuid,p_email text) returns public.rewards_program_staff language plpgsql security definer set search_path=public as $$
declare r public.rewards_program_staff; b uuid;
begin
 select p.business_id into b from public.rewards_loyalty_programs p join public.rewards_businesses x on x.id=p.business_id where p.id=p_program_id and x.owner_id=auth.uid();
 if b is null then raise exception 'Sin permiso.'; end if;
 insert into public.rewards_program_staff(program_id,business_id,email,user_id,status) values(p_program_id,b,lower(trim(p_email)),(select id from auth.users where lower(email)=lower(trim(p_email)) limit 1),'active')
 on conflict(program_id,email) do update set status='active',user_id=coalesce(excluded.user_id,rewards_program_staff.user_id) returning * into r; return r;
end$$;
grant execute on function public.rewards_add_program_staff(uuid,text) to authenticated;

create or replace function public.rewards_set_access_expiry(p_customer_id uuid,p_expires_at timestamptz) returns table(public_code text,expires_at timestamptz,status text) language plpgsql security definer set search_path=public as $$
declare c public.rewards_customers%rowtype;
begin
 select c0.* into c from public.rewards_customers c0 join public.rewards_businesses b on b.id=c0.business_id where c0.id=p_customer_id and b.owner_id=auth.uid() for update of c0;
 if not found then raise exception 'Sin permiso.'; end if;
 update public.rewards_customers set expires_at=p_expires_at where id=c.id; return query select c.public_code,p_expires_at,c.status;
end$$;
grant execute on function public.rewards_set_access_expiry(uuid,timestamptz) to authenticated;

create or replace function public.rewards_set_access_status(p_customer_id uuid,p_status text) returns table(public_code text,status text) language plpgsql security definer set search_path=public as $$
declare c public.rewards_customers%rowtype; s text;
begin
 s:=case when lower(p_status)='active' then 'active' else 'inactive' end;
 select c0.* into c from public.rewards_customers c0 join public.rewards_businesses b on b.id=c0.business_id where c0.id=p_customer_id and b.owner_id=auth.uid() for update of c0;
 if not found then raise exception 'Sin permiso.'; end if;
 update public.rewards_customers set status=s where id=c.id; return query select c.public_code,s;
end$$;
grant execute on function public.rewards_set_access_status(uuid,text) to authenticated;

-- Acción única para empleados: solo operaciones de escaneo, nunca configuración/edición.
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

-- Lectura de escaneo por dueño o empleado asignado, acepta código público o dinámico.
create or replace function public.rewards_scan_lookup(p_code text) returns setof public.rewards_customers language sql security definer stable set search_path=public as $$
 select c.* from public.rewards_customers c join public.rewards_loyalty_programs p on p.id=c.program_id join public.rewards_businesses b on b.id=c.business_id
 where (c.public_code=upper(trim(p_code)) or c.dynamic_code=upper(trim(p_code))) and (b.owner_id=auth.uid() or public.rewards_is_program_staff(p.id)) limit 1; $$;
grant execute on function public.rewards_scan_lookup(text) to authenticated;

-- El dueño también rota el código dinámico al registrar un acceso.
create or replace function public.rewards_mark_access(p_customer_id uuid,p_action text default 'entry')
returns table(public_code text,expires_at timestamptz,last_access_state text,action text)
language plpgsql security definer set search_path=public as $$
declare v_customer public.rewards_customers%rowtype; v_mode text; v_action text; v_tx text; newcode text;
begin
 select c.* into v_customer from public.rewards_customers c join public.rewards_businesses b on b.id=c.business_id where c.id=p_customer_id and b.owner_id=auth.uid() for update of c;
 if not found then raise exception 'Cliente no encontrado o sin permiso.'; end if;
 select p.access_mode into v_mode from public.rewards_loyalty_programs p where p.id=v_customer.program_id and p.program_type='access';
 if v_customer.status='inactive' then raise exception 'Esta credencial está suspendida.'; end if;
 if v_customer.expires_at is null or v_customer.expires_at<now() then raise exception 'Esta credencial está vencida.'; end if;
 if v_mode='entry_exit' then v_action:=case when lower(coalesce(p_action,'')) in('out','exit','salida') then 'out' else 'in' end; v_tx:=case when v_action='out' then 'access_out' else 'access_in' end;
 else v_action:='entry';v_tx:='access_entry'; end if;
 newcode:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
 update public.rewards_customers set last_access_state=case when v_mode='entry_exit' then v_action else last_access_state end,dynamic_code=newcode,dynamic_code_updated_at=now() where id=p_customer_id;
 insert into public.rewards_loyalty_transactions(business_id,program_id,customer_id,type,amount,note,created_by) values(v_customer.business_id,v_customer.program_id,v_customer.id,v_tx,1,case when v_action='out' then 'Salida registrada' else 'Entrada registrada' end,auth.uid());
 return query select v_customer.public_code,v_customer.expires_at,case when v_mode='entry_exit' then v_action else v_customer.last_access_state end,v_action;
end$$;
grant execute on function public.rewards_mark_access(uuid,text) to authenticated;
