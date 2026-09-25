-- 016J · Administración global Rewards Enla. Ejecutar después de 016I.
-- Las cuentas administradoras se identifican por UUID de auth.users, no por correo enviado por el navegador.
create table if not exists public.rewards_platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now()
);
alter table public.rewards_platform_admins enable row level security;
revoke all on public.rewards_platform_admins from public, anon, authenticated;
-- Inicialización exclusiva desde SQL Editor con privilegios de administración del proyecto.
do $$
declare v_uid uuid; v_n integer;
begin
 select count(*), min(id) into v_n,v_uid from auth.users where lower(email)='sanhost987@gmail.com';
 if v_n<>1 then raise exception 'No se encontró exactamente una cuenta sanhost987@gmail.com. No se instaló el permiso admin.'; end if;
 insert into public.rewards_platform_admins(user_id) values(v_uid) on conflict do nothing;
end $$;

alter table public.rewards_businesses add column if not exists manual_plan text;
alter table public.rewards_businesses drop constraint if exists rewards_businesses_manual_plan_check;
alter table public.rewards_businesses add constraint rewards_businesses_manual_plan_check
 check (manual_plan is null or manual_plan in ('basic','pro','business'));

create table if not exists public.rewards_admin_audit (
 id uuid primary key default gen_random_uuid(),
 admin_id uuid not null references auth.users(id),
 action text not null,
 business_id uuid references public.rewards_businesses(id) on delete set null,
 program_id uuid references public.rewards_loyalty_programs(id) on delete set null,
 details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
alter table public.rewards_admin_audit enable row level security;
revoke all on public.rewards_admin_audit from public,anon,authenticated;

create or replace function public.rewards_adminx_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and exists
 (select 1 from public.rewards_platform_admins a where a.user_id=auth.uid());
$$;
revoke all on function public.rewards_adminx_is_admin() from public,anon;
grant execute on function public.rewards_adminx_is_admin() to authenticated;

-- Totales globales, clientes por negocio y páginas de tarjetas, sin exponer a la sesión filas fuera de los RPC.
create or replace function public.rewards_adminx_overview(p_search text default '', p_business_offset int default 0, p_program_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
 if not public.rewards_adminx_is_admin() then raise exception 'Acceso no autorizado.'; end if;
 select jsonb_build_object(
  'metrics',jsonb_build_object(
    'businesses',(select count(*) from public.rewards_businesses),
    'programs',(select count(*) from public.rewards_loyalty_programs),
    'published',(select count(*) from public.rewards_loyalty_programs where publication_status='published'),
    'drafts',(select count(*) from public.rewards_loyalty_programs where publication_status='draft'),
    'customers',(select count(*) from public.rewards_customers where coalesce(status,'active')<>'deleted'),
    'paid',(select count(*) from public.rewards_businesses where rewards_plan<>'trial' and subscription_status in ('active','trialing'))
  ),
  'business_total',(select count(*) from public.rewards_businesses b join auth.users u on u.id=b.owner_id
     where p_search='' or b.business_name ilike '%'||p_search||'%' or u.email ilike '%'||p_search||'%'),
  'program_total',(select count(*) from public.rewards_loyalty_programs p join public.rewards_businesses b on b.id=p.business_id
     where p_search='' or p.program_name ilike '%'||p_search||'%' or b.business_name ilike '%'||p_search||'%'),
  'businesses',coalesce((select jsonb_agg(to_jsonb(t)) from (
   select b.id,b.business_name,b.rewards_plan,b.manual_plan,b.subscription_status,b.stripe_subscription_id,b.created_at,u.email,
    (select count(*) from public.rewards_loyalty_programs p where p.business_id=b.id)::int as cards,
    (select count(*) from public.rewards_loyalty_programs p where p.business_id=b.id and p.publication_status='published')::int as published,
    (select count(*) from public.rewards_customers c where c.business_id=b.id and coalesce(c.status,'active')<>'deleted')::int as customers
   from public.rewards_businesses b join auth.users u on u.id=b.owner_id
   where p_search='' or b.business_name ilike '%'||p_search||'%' or u.email ilike '%'||p_search||'%'
   order by b.created_at desc,b.id limit 50 offset greatest(p_business_offset,0)
  ) t),'[]'::jsonb),
  'programs',coalesce((select jsonb_agg(to_jsonb(t)) from (
   select p.id,p.business_id,p.program_name,p.display_name,p.program_type,p.publication_status,p.status,p.created_at,
    b.business_name,b.rewards_plan,u.email,
    (select count(*) from public.rewards_customers c where c.program_id=p.id and coalesce(c.status,'active')<>'deleted')::int as customers
   from public.rewards_loyalty_programs p join public.rewards_businesses b on b.id=p.business_id join auth.users u on u.id=b.owner_id
   where p_search='' or p.program_name ilike '%'||p_search||'%' or b.business_name ilike '%'||p_search||'%'
   order by p.created_at desc,p.id limit 50 offset greatest(p_program_offset,0)
  ) t),'[]'::jsonb)
 ) into result;
 return result;
end $$;
revoke all on function public.rewards_adminx_overview(text,int,int) from public,anon;
grant execute on function public.rewards_adminx_overview(text,int,int) to authenticated;

-- Exclusivamente planes de cortesía, nunca altera un cobro ni crea una suscripción Stripe.
create or replace function public.rewards_adminx_assign_plan(p_business_id uuid,p_plan text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.rewards_businesses%rowtype;
begin
 if not public.rewards_adminx_is_admin() then raise exception 'Acceso no autorizado.'; end if;
 if p_plan not in ('trial','basic','pro','business') then raise exception 'Plan inválido.'; end if;
 select * into b from public.rewards_businesses where id=p_business_id for update;
 if not found then raise exception 'Negocio no encontrado.'; end if;
 if b.stripe_subscription_id is not null and b.subscription_status in ('active','trialing','past_due','unpaid') then
  raise exception 'La cuenta tiene suscripción Stripe vinculada. Primero gestiona esa suscripción desde Stripe; no se modifica ni cancela desde Adminx.';
 end if;
 if p_plan='trial' and exists(select 1 from public.rewards_loyalty_programs where business_id=b.id and publication_status='published') then
  raise exception 'El negocio tiene tarjetas publicadas. Pásalas a borrador antes de retirar el plan de cortesía.';
 end if;
 update public.rewards_businesses set manual_plan=nullif(p_plan,'trial'),rewards_plan=p_plan,
   subscription_status=case when p_plan='trial' then 'trial' else 'active' end,
   subscription_current_period_end=null,subscription_cancel_at_period_end=false
 where id=b.id;
 insert into public.rewards_admin_audit(admin_id,action,business_id,details)
 values(auth.uid(),'manual_plan',b.id,jsonb_build_object('old_plan',b.rewards_plan,'new_plan',p_plan));
 return jsonb_build_object('success',true,'plan',p_plan);
end $$;
revoke all on function public.rewards_adminx_assign_plan(uuid,text) from public,anon;
grant execute on function public.rewards_adminx_assign_plan(uuid,text) to authenticated;

-- Primero ofrecer vista previa de transferencia, incluida la decisión de publicación.
create or replace function public.rewards_adminx_transfer_preview(p_program_id uuid,p_target_business_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p public.rewards_loyalty_programs%rowtype; b public.rewards_businesses%rowtype; used_count int; lim int; will_publish boolean;
begin
 if not public.rewards_adminx_is_admin() then raise exception 'Acceso no autorizado.'; end if;
 select * into p from public.rewards_loyalty_programs where id=p_program_id;
 if not found then raise exception 'Tarjeta no encontrada.'; end if;
 select * into b from public.rewards_businesses where id=p_target_business_id;
 if not found then raise exception 'Negocio destino no encontrado.'; end if;
 if p.business_id=b.id then raise exception 'La tarjeta ya pertenece a este negocio.'; end if;
 select count(*) into used_count from public.rewards_loyalty_programs where business_id=b.id and publication_status='published';
 lim:=coalesce((public.rewards_plan_limits(b.rewards_plan)->>'published_cards')::int,0);
 will_publish:=p.publication_status='published' and b.rewards_plan<>'trial' and b.subscription_status in ('active','trialing') and used_count<lim;
 return jsonb_build_object('card',p.program_name,'source_business_id',p.business_id,'target_business',b.business_name,
 'target_plan',b.rewards_plan,'customers',(select count(*) from public.rewards_customers where program_id=p.id),
 'transactions',(select count(*) from public.rewards_loyalty_transactions where program_id=p.id),
 'staff',(select count(*) from public.rewards_program_staff where program_id=p.id),
 'notifications',(select count(*) from public.rewards_notifications where program_id=p.id),
 'old_status',p.publication_status,'new_status',case when will_publish then 'published' else 'draft' end);
end $$;
revoke all on function public.rewards_adminx_transfer_preview(uuid,uuid) from public,anon;
grant execute on function public.rewards_adminx_transfer_preview(uuid,uuid) to authenticated;

create or replace function public.rewards_adminx_transfer(p_program_id uuid,p_target_business_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.rewards_loyalty_programs%rowtype; b public.rewards_businesses%rowtype; used_count int; lim int; new_status text; moved_customers int; moved_transactions int;
begin
 if not public.rewards_adminx_is_admin() then raise exception 'Acceso no autorizado.'; end if;
 -- El cambio de todas las tablas ocurre dentro de una misma transacción RPC.
 select * into p from public.rewards_loyalty_programs where id=p_program_id for update;
 if not found then raise exception 'Tarjeta no encontrada.'; end if;
 select * into b from public.rewards_businesses where id=p_target_business_id for update;
 if not found then raise exception 'Negocio destino no encontrado.'; end if;
 if p.business_id=b.id then raise exception 'La tarjeta ya pertenece al negocio de destino.'; end if;
 -- La propiedad de los registros debe ser consistente antes de transferir.
 if exists(select 1 from public.rewards_customers where program_id=p.id and business_id<>p.business_id)
  or exists(select 1 from public.rewards_loyalty_transactions where program_id=p.id and business_id<>p.business_id)
  or exists(select 1 from public.rewards_program_staff where program_id=p.id and business_id<>p.business_id)
  or exists(select 1 from public.rewards_notifications where program_id=p.id and business_id<>p.business_id) then
  raise exception 'Hay registros asociados a otro negocio. Revisa la integridad antes de transferir.';
 end if;
 select count(*) into used_count from public.rewards_loyalty_programs where business_id=b.id and publication_status='published';
 lim:=coalesce((public.rewards_plan_limits(b.rewards_plan)->>'published_cards')::int,0);
 new_status:=case when p.publication_status='published' and b.rewards_plan<>'trial' and b.subscription_status in ('active','trialing') and used_count<lim
  then 'published' else 'draft' end;
 -- No activamos nuevas notificaciones en un destino sin plan, pero conservamos la configuración.
 -- Desactivar cumpleaños antes del cambio impide rechazo por trigger de plan en el negocio destino.
 if new_status='draft' then
  update public.rewards_loyalty_programs set birthday_enabled=false,geo_enabled=false where id=p.id and (birthday_enabled=true or geo_enabled=true);
 end if;
 update public.rewards_loyalty_programs set business_id=b.id,publication_status=new_status,
  published_at=case when new_status='published' then published_at else null end,
  updated_at=now() where id=p.id;
 update public.rewards_customers set business_id=b.id,
  apple_updated_at=greatest(coalesce(apple_updated_at,0)+1,(extract(epoch from clock_timestamp())*1000)::bigint)
 where program_id=p.id;
 get diagnostics moved_customers=row_count;
 update public.rewards_loyalty_transactions set business_id=b.id where program_id=p.id;
 get diagnostics moved_transactions=row_count;
 update public.rewards_program_staff set business_id=b.id where program_id=p.id;
 update public.rewards_notifications set business_id=b.id where program_id=p.id;
 insert into public.rewards_admin_audit(admin_id,action,business_id,program_id,details)
 values(auth.uid(),'transfer',b.id,p.id,jsonb_build_object('from',p.business_id,'to',b.id,'old_status',p.publication_status,'new_status',new_status,'customers',moved_customers,'transactions',moved_transactions));
 return jsonb_build_object('success',true,'program_id',p.id,'status',new_status,'customers',moved_customers,'transactions',moved_transactions);
end $$;
revoke all on function public.rewards_adminx_transfer(uuid,uuid) from public,anon;
grant execute on function public.rewards_adminx_transfer(uuid,uuid) to authenticated;
