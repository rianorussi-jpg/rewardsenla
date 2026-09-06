-- 013 · Tarjeta de identificación / acceso
-- Ejecutar después de 012-panel-scope-cashback-adjustments.sql.

alter table public.rewards_loyalty_programs
  add column if not exists service_name text,
  add column if not exists validity_days integer not null default 30,
  add column if not exists access_mode text not null default 'unlimited';

alter table public.rewards_loyalty_programs drop constraint if exists rewards_loyalty_programs_program_type_check;
alter table public.rewards_loyalty_programs add constraint rewards_loyalty_programs_program_type_check
  check (program_type in ('stamps','cashback','visits','access'));

alter table public.rewards_loyalty_programs drop constraint if exists rewards_loyalty_programs_goal_count_check;
alter table public.rewards_loyalty_programs add constraint rewards_loyalty_programs_goal_count_check
  check (
    (program_type in ('cashback','access') and goal_count=0)
    or (program_type='stamps' and goal_count between 2 and 1000)
    or (program_type='visits' and goal_count between 1 and 1000)
  );

alter table public.rewards_loyalty_programs drop constraint if exists rewards_loyalty_programs_access_mode_check;
alter table public.rewards_loyalty_programs add constraint rewards_loyalty_programs_access_mode_check
  check (access_mode in ('unlimited','entry_exit'));

alter table public.rewards_loyalty_programs drop constraint if exists rewards_loyalty_programs_validity_days_check;
alter table public.rewards_loyalty_programs add constraint rewards_loyalty_programs_validity_days_check
  check (validity_days between 1 and 3650);

alter table public.rewards_customers
  add column if not exists photo_url text,
  add column if not exists expires_at timestamptz,
  add column if not exists last_access_state text not null default 'out';

alter table public.rewards_customers drop constraint if exists rewards_customers_last_access_state_check;
alter table public.rewards_customers add constraint rewards_customers_last_access_state_check
  check (last_access_state in ('in','out'));

alter table public.rewards_loyalty_transactions drop constraint if exists rewards_loyalty_transactions_type_check;
alter table public.rewards_loyalty_transactions add constraint rewards_loyalty_transactions_type_check
  check(type in ('stamp','cashback','visit','visit_use','visit_renew','deactivate','spend','redeem','adjustment','access_in','access_out','access_entry','access_renew'));

-- Fotos de identificación. Se suben desde el alta pública.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('rewards-customer-photos','rewards-customer-photos',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];

drop policy if exists "rewards customer photos public read" on storage.objects;
create policy "rewards customer photos public read" on storage.objects for select using (bucket_id='rewards-customer-photos');
drop policy if exists "rewards customer photos public upload" on storage.objects;
create policy "rewards customer photos public upload" on storage.objects for insert to anon,authenticated with check (bucket_id='rewards-customer-photos');

-- Datos públicos del programa.
drop function if exists public.rewards_public_program_card(text);
create function public.rewards_public_program_card(p_program_slug text)
returns table(
  business_name text, program_id uuid, public_slug text, program_name text, display_name text,
  program_type text, goal_count integer, increment_value numeric, reward_text text, promo_text text,
  primary_color text, secondary_color text, card_style text, stamp_icon text,
  stamp_filled_image_url text, stamp_empty_image_url text,
  logo_url text, central_image_url text, barcode_format text,
  service_name text, validity_days integer, access_mode text
)
language sql security definer set search_path=public stable as $$
  select b.business_name,p.id,p.public_slug,p.program_name,p.display_name,p.program_type,p.goal_count,
         p.increment_value,p.reward_text,p.promo_text,p.primary_color,p.secondary_color,p.card_style,
         p.stamp_icon,p.stamp_filled_image_url,p.stamp_empty_image_url,p.logo_url,
         case when p.program_type='stamps' then null else p.central_image_url end,
         coalesce(p.barcode_format,'qr'),p.service_name,p.validity_days,p.access_mode
  from public.rewards_loyalty_programs p
  join public.rewards_businesses b on b.id=p.business_id
  where (p.public_slug=p_program_slug or p.id::text=p_program_slug) and p.status='active'
  limit 1;
$$;
grant execute on function public.rewards_public_program_card(text) to anon,authenticated;

-- Alta pública: foto obligatoria para identificación/acceso y vencimiento individual.
drop function if exists public.rewards_join_program_card(text,text,text,text);
drop function if exists public.rewards_join_program_card(text,text,text,text,text);
create function public.rewards_join_program_card(
  p_program_slug text,p_name text,p_email text default null,p_phone text default null,p_photo_url text default null
)
returns table(public_code text, customer_name text)
language plpgsql security definer set search_path=public as $$
declare
  v_business uuid; v_program uuid; v_code text; v_name text; v_type text; v_goal integer; v_initial numeric:=0; v_days integer:=30;
begin
  if length(trim(coalesce(p_name,'')))<2 then raise exception 'Escribe tu nombre.'; end if;
  select p.business_id,p.id,p.program_type,p.goal_count,p.validity_days
    into v_business,v_program,v_type,v_goal,v_days
  from public.rewards_loyalty_programs p
  where (p.public_slug=p_program_slug or p.id::text=p_program_slug) and p.status='active' limit 1;
  if v_program is null then raise exception 'Esta tarjeta no existe o no está activa.'; end if;
  if nullif(trim(coalesce(p_email,'')),'') is null and nullif(trim(coalesce(p_phone,'')),'') is null then raise exception 'Agrega correo o teléfono.'; end if;
  if v_type='access' and nullif(trim(coalesce(p_photo_url,'')),'') is null then raise exception 'Sube una foto para tu identificación.'; end if;
  select c.public_code,c.name into v_code,v_name from public.rewards_customers c
  where c.program_id=v_program and (
    (nullif(lower(trim(coalesce(p_email,''))),'') is not null and lower(c.email)=lower(trim(p_email)))
    or (nullif(trim(coalesce(p_phone,'')),'') is not null and c.phone=trim(p_phone))
  ) order by c.created_at desc limit 1;
  if v_code is null then
    v_initial:=case when v_type='visits' then greatest(coalesce(v_goal,1),1) else 0 end;
    insert into public.rewards_customers(business_id,program_id,name,email,phone,current_value,status,photo_url,expires_at,last_access_state)
    values(v_business,v_program,trim(p_name),nullif(lower(trim(coalesce(p_email,''))),''),nullif(trim(coalesce(p_phone,'')),''),v_initial,'active',
      case when v_type='access' then p_photo_url else null end,
      case when v_type='access' then now() + make_interval(days=>greatest(coalesce(v_days,30),1)) else null end,
      'out')
    returning rewards_customers.public_code,rewards_customers.name into v_code,v_name;
  end if;
  return query select v_code,v_name;
end;$$;
grant execute on function public.rewards_join_program_card(text,text,text,text,text) to anon,authenticated;

-- Tarjeta pública completa.
drop function if exists public.rewards_public_card(text);
create function public.rewards_public_card(p_code text)
returns table(
  public_code text, customer_name text, current_value numeric, customer_status text,
  business_name text, program_name text, display_name text, program_type text, goal_count integer,
  increment_value numeric, reward_text text, promo_text text, primary_color text, secondary_color text,
  card_style text, stamp_icon text, stamp_filled_image_url text, stamp_empty_image_url text,
  logo_url text, central_image_url text, apple_enabled boolean, google_enabled boolean, barcode_format text,
  customer_photo_url text, customer_expires_at timestamptz, last_access_state text,
  service_name text, validity_days integer, access_mode text
)
language sql security definer set search_path=public stable as $$
  select c.public_code,c.name,c.current_value,c.status,b.business_name,p.program_name,p.display_name,
         p.program_type,p.goal_count,p.increment_value,p.reward_text,p.promo_text,p.primary_color,
         p.secondary_color,p.card_style,p.stamp_icon,p.stamp_filled_image_url,p.stamp_empty_image_url,
         p.logo_url,case when p.program_type='stamps' then null else p.central_image_url end,
         p.apple_enabled,p.google_enabled,coalesce(p.barcode_format,'qr'),c.photo_url,c.expires_at,c.last_access_state,
         p.service_name,p.validity_days,p.access_mode
  from public.rewards_customers c
  join public.rewards_businesses b on b.id=c.business_id
  left join public.rewards_loyalty_programs p on p.id=c.program_id
  where c.public_code=upper(p_code)
  limit 1;
$$;
grant execute on function public.rewards_public_card(text) to anon,authenticated;

create or replace function public.rewards_mark_access(p_customer_id uuid,p_action text default 'entry')
returns table(public_code text,expires_at timestamptz,last_access_state text,action text)
language plpgsql security definer set search_path=public as $$
declare v_customer public.rewards_customers%rowtype; v_mode text; v_action text; v_tx text;
begin
  select c.* into v_customer from public.rewards_customers c join public.rewards_businesses b on b.id=c.business_id
  where c.id=p_customer_id and b.owner_id=auth.uid() for update of c;
  if not found then raise exception 'Cliente no encontrado o sin permiso.'; end if;
  select p.access_mode into v_mode from public.rewards_loyalty_programs p where p.id=v_customer.program_id and p.program_type='access';
  if v_mode is null then raise exception 'Esta tarjeta no es de identificación/acceso.'; end if;
  if v_customer.status='inactive' then raise exception 'Esta credencial está desactivada.'; end if;
  if v_customer.expires_at is null or v_customer.expires_at<now() then raise exception 'Esta credencial está vencida.'; end if;
  if v_mode='entry_exit' then
    v_action:=case when lower(coalesce(p_action,'')) in ('out','exit','salida') then 'out' else 'in' end;
    update public.rewards_customers set last_access_state=v_action where id=p_customer_id;
    v_tx:=case when v_action='out' then 'access_out' else 'access_in' end;
  else
    v_action:='entry'; v_tx:='access_entry';
  end if;
  insert into public.rewards_loyalty_transactions(business_id,program_id,customer_id,type,amount,note,created_by)
  values(v_customer.business_id,v_customer.program_id,v_customer.id,v_tx,1,
    case when v_action='out' then 'Salida registrada' else 'Entrada registrada' end,auth.uid());
  return query select v_customer.public_code,v_customer.expires_at,case when v_mode='entry_exit' then v_action else v_customer.last_access_state end,v_action;
end;$$;
grant execute on function public.rewards_mark_access(uuid,text) to authenticated;

create or replace function public.rewards_renew_access(p_customer_id uuid,p_days integer default null)
returns table(public_code text,expires_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare v_customer public.rewards_customers%rowtype; v_days integer; v_type text; v_new timestamptz;
begin
  select c.* into v_customer from public.rewards_customers c join public.rewards_businesses b on b.id=c.business_id
  where c.id=p_customer_id and b.owner_id=auth.uid() for update of c;
  if not found then raise exception 'Cliente no encontrado o sin permiso.'; end if;
  select p.program_type,p.validity_days into v_type,v_days from public.rewards_loyalty_programs p where p.id=v_customer.program_id;
  if v_type<>'access' then raise exception 'Esta tarjeta no es de identificación/acceso.'; end if;
  v_days:=greatest(coalesce(p_days,v_days,30),1);
  v_new:=greatest(coalesce(v_customer.expires_at,now()),now()) + make_interval(days=>v_days);
  update public.rewards_customers set expires_at=v_new,status='active' where id=p_customer_id;
  insert into public.rewards_loyalty_transactions(business_id,program_id,customer_id,type,amount,note,created_by)
  values(v_customer.business_id,v_customer.program_id,v_customer.id,'access_renew',v_days,'Vigencia renovada '||v_days||' días',auth.uid());
  return query select v_customer.public_code,v_new;
end;$$;
grant execute on function public.rewards_renew_access(uuid,integer) to authenticated;
