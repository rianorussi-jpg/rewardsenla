-- Rewards Enla 016A: hasta 15 borradores para todos + límites por tarjetas PUBLICADAS
-- Ejecutar después de 016-billing-plans.sql.

create or replace function public.rewards_plan_limits(p_plan text)
returns jsonb language sql immutable as $$
 select case p_plan
  when 'business' then jsonb_build_object('cards',15,'published_cards',15,'draft_cards',15,'clients',5000,'staff',20,'notifications',5000,'geolocation',true)
  when 'pro' then jsonb_build_object('cards',5,'published_cards',5,'draft_cards',15,'clients',1000,'staff',5,'notifications',1000,'geolocation',true)
  when 'basic' then jsonb_build_object('cards',1,'published_cards',1,'draft_cards',15,'clients',100,'staff',1,'notifications',100,'geolocation',false)
  else jsonb_build_object('cards',0,'published_cards',0,'draft_cards',15,'clients',3,'staff',1,'notifications',3,'geolocation',false)
 end;
$$;

-- Crear tarjetas ya no depende del plan. Todas las cuentas pueden tener hasta 15 tarjetas totales,
-- pero toda tarjeta nueva nace como borrador. El plan solamente limita cuántas pueden estar publicadas.
create or replace function public.rewards_enforce_program_limit() returns trigger language plpgsql as $$
declare used int;
begin
 select count(*) into used from public.rewards_loyalty_programs where business_id=new.business_id;
 if tg_op='INSERT' and used >= 15 then
   raise exception 'Puedes tener un máximo de 15 tarjetas entre borradores y publicadas.';
 end if;
 if tg_op='INSERT' then
   new.publication_status := 'draft';
   new.published_at := null;
 end if;
 return new;
end $$;

drop trigger if exists rewards_program_limit_trigger on public.rewards_loyalty_programs;
create trigger rewards_program_limit_trigger before insert on public.rewards_loyalty_programs
for each row execute function public.rewards_enforce_program_limit();

-- Estado de publicación para que el frontend sepa si puede publicar sin abrir planes.
create or replace function public.rewards_publication_overview(p_program_id uuid default null)
returns table(
  plan text,
  status text,
  published_count int,
  published_limit int,
  total_cards int,
  can_publish boolean,
  reason text
)
language plpgsql security definer set search_path=public as $$
declare b public.rewards_businesses%rowtype; pc int; tc int; lim int; target_status text;
begin
 select * into b from public.rewards_businesses where owner_id=auth.uid() limit 1;
 if b.id is null then raise exception 'No se encontró el negocio.'; end if;
 select count(*)::int into pc from public.rewards_loyalty_programs where business_id=b.id and publication_status='published';
 select count(*)::int into tc from public.rewards_loyalty_programs where business_id=b.id;
 lim := coalesce((public.rewards_plan_limits(coalesce(b.rewards_plan,'trial'))->>'published_cards')::int,0);
 if p_program_id is not null then
   select publication_status into target_status from public.rewards_loyalty_programs where id=p_program_id and business_id=b.id;
   if target_status is null then raise exception 'Tarjeta no encontrada.'; end if;
 end if;
 return query select b.rewards_plan,b.subscription_status,pc,lim,tc,
   case
     when target_status='published' then true
     when b.rewards_plan='trial' or b.subscription_status not in ('active','trialing') then false
     when pc >= lim then false
     else true
   end,
   case
     when target_status='published' then 'already_published'
     when b.rewards_plan='trial' or b.subscription_status not in ('active','trialing') then 'plan_required'
     when pc >= lim then 'published_limit'
     else 'ok'
   end;
end $$;
grant execute on function public.rewards_publication_overview(uuid) to authenticated;

-- Publicar siempre se valida también en backend.
create or replace function public.rewards_publish_program(p_program_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare b public.rewards_businesses%rowtype; lim int; used int; ps text;
begin
 select b.* into b from public.rewards_businesses b
 join public.rewards_loyalty_programs p on p.business_id=b.id
 where p.id=p_program_id and b.owner_id=auth.uid();
 if b.id is null then raise exception 'Tarjeta no encontrada.'; end if;
 select publication_status into ps from public.rewards_loyalty_programs where id=p_program_id and business_id=b.id;
 if ps='published' then return true; end if;
 if b.rewards_plan='trial' or b.subscription_status not in ('active','trialing') then
   raise exception 'PLAN_REQUIRED: Debes contratar un plan para publicar esta tarjeta.';
 end if;
 lim := coalesce((public.rewards_plan_limits(b.rewards_plan)->>'published_cards')::int,0);
 select count(*)::int into used from public.rewards_loyalty_programs where business_id=b.id and publication_status='published';
 if used >= lim then
   raise exception 'PUBLISHED_LIMIT: Tu plan % permite % tarjeta(s) publicada(s). Apaga una tarjeta o mejora tu plan.',b.rewards_plan,lim;
 end if;
 update public.rewards_loyalty_programs
 set publication_status='published',published_at=coalesce(published_at,now())
 where id=p_program_id and business_id=b.id;
 return true;
end $$;
grant execute on function public.rewards_publish_program(uuid) to authenticated;

create or replace function public.rewards_unpublish_program(p_program_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare bid uuid;
begin
 select p.business_id into bid from public.rewards_loyalty_programs p
 join public.rewards_businesses b on b.id=p.business_id
 where p.id=p_program_id and b.owner_id=auth.uid();
 if bid is null then raise exception 'Tarjeta no encontrada.'; end if;
 update public.rewards_loyalty_programs set publication_status='draft' where id=p_program_id and business_id=bid;
 return true;
end $$;
grant execute on function public.rewards_unpublish_program(uuid) to authenticated;
