-- Rewards Enla · Actualizacion de cupos por plan (2026-09-24)
-- Ejecutar DESPUES de 016A. No vuelve a ejecutar ni modifica las migraciones historicas.
-- Los automatismos de cumpleaños/recordatorios y la segunda sucursal por tarjeta
-- requieren implementacion independiente: esta migracion NO los crea.

create or replace function public.rewards_plan_limits(p_plan text)
returns jsonb language sql immutable as $$
 select case p_plan
  when 'business' then jsonb_build_object(
    'cards',15,'published_cards',15,'draft_cards',2147483647,
    'clients',2147483647,'staff',2147483647,'notifications',2147483647,
    'geolocation',true,'geo_locations_per_card',2)
  when 'pro' then jsonb_build_object(
    'cards',5,'published_cards',5,'draft_cards',2147483647,
    'clients',2147483647,'staff',5,'notifications',2147483647,
    'geolocation',true,'geo_locations_per_card',2)
  when 'basic' then jsonb_build_object(
    'cards',1,'published_cards',1,'draft_cards',15,
    'clients',1000,'staff',1,'notifications',0,
    'geolocation',true,'geo_locations_per_card',1)
  else jsonb_build_object(
    'cards',0,'published_cards',0,'draft_cards',15,
    'clients',3,'staff',0,'notifications',0,
    'geolocation',false,'geo_locations_per_card',0)
 end;
$$;

-- Los cupos de borradores son independientes de los de tarjetas publicadas.
create or replace function public.rewards_enforce_program_limit()
returns trigger language plpgsql as $$
declare v_plan text; v_limit int; v_drafts int;
begin
 if tg_op='INSERT' then
   select coalesce(b.rewards_plan,'trial') into v_plan
   from public.rewards_businesses b where b.id=new.business_id;
   if v_plan is null then raise exception 'No se encontro el negocio.'; end if;
   v_limit := (public.rewards_plan_limits(v_plan)->>'draft_cards')::int;
   -- Si la tarjeta llega a ser publicada, deja de ocupar espacio de borrador.
   select count(*)::int into v_drafts
   from public.rewards_loyalty_programs p
   where p.business_id=new.business_id and p.publication_status='draft';
   if v_drafts >= v_limit then
     raise exception 'Tu plan permite un maximo de % tarjetas en borrador.',v_limit;
   end if;
   new.publication_status:='draft';
   new.published_at:=null;
 end if;
 return new;
end $$;

-- Trial: 3 clientes en total; Basico: 1000 en el negocio;
-- Pro/Negocio: sin tope aplicativo por tarjeta publicada.
create or replace function public.rewards_enforce_customer_limit()
returns trigger language plpgsql as $$
declare v_business uuid; v_plan text; v_limit int; v_used int;
begin
 if tg_op='INSERT' then
   select p.business_id into v_business
   from public.rewards_loyalty_programs p where p.id=new.program_id;
   select coalesce(b.rewards_plan,'trial') into v_plan
   from public.rewards_businesses b where b.id=v_business;
   v_limit := (public.rewards_plan_limits(coalesce(v_plan,'trial'))->>'clients')::int;
   if v_limit < 2147483647 then
     select count(*)::int into v_used from public.rewards_customers c
     join public.rewards_loyalty_programs p on p.id=c.program_id
     where p.business_id=v_business and coalesce(c.status,'active')<>'deleted';
     if v_used >= v_limit then
       raise exception 'Tu plan permite un maximo de % clientes.',v_limit;
     end if;
   end if;
 end if;
 return new;
end $$;

-- Personal autorizado por TARJETA, no por negocio. Incluye invitaciones
-- por RPC y escrituras directas a rewards_program_staff.
create or replace function public.rewards_enforce_staff_plan_limit()
returns trigger language plpgsql as $$
declare v_plan text; v_limit int; v_used int;
begin
 if new.status='active' then
   if tg_op='UPDATE' then
     if old.status='active' and old.program_id=new.program_id then return new; end if;
   end if;
   select coalesce(b.rewards_plan,'trial') into v_plan
   from public.rewards_loyalty_programs p
   join public.rewards_businesses b on b.id=p.business_id
   where p.id=new.program_id;
   v_limit := (public.rewards_plan_limits(coalesce(v_plan,'trial'))->>'staff')::int;
   if v_limit < 2147483647 then
     select count(*)::int into v_used from public.rewards_program_staff s
     where s.program_id=new.program_id and s.status='active'
       and (tg_op='INSERT' or s.id<>new.id);
     if v_used>=v_limit then
       raise exception 'Tu plan permite un maximo de % empleado(s) por tarjeta.',v_limit;
     end if;
   end if;
 end if;
 return new;
end $$;

drop trigger if exists rewards_staff_plan_limit_trigger on public.rewards_program_staff;
create trigger rewards_staff_plan_limit_trigger
before insert or update of status,program_id on public.rewards_program_staff
for each row execute function public.rewards_enforce_staff_plan_limit();
