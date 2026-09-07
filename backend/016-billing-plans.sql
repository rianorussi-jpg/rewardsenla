-- Rewards Enla: planes, publicación y límites
alter table public.rewards_businesses
  add column if not exists rewards_plan text not null default 'trial',
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text not null default 'trial',
  add column if not exists subscription_current_period_end timestamptz,
  add column if not exists subscription_cancel_at_period_end boolean not null default false;

alter table public.rewards_loyalty_programs
  add column if not exists publication_status text not null default 'draft',
  add column if not exists published_at timestamptz;

do $$ begin
  alter table public.rewards_businesses add constraint rewards_businesses_plan_check check (rewards_plan in ('trial','basic','pro','business'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.rewards_loyalty_programs add constraint rewards_program_publication_check check (publication_status in ('draft','published'));
exception when duplicate_object then null; end $$;

create or replace function public.rewards_plan_limits(p_plan text)
returns jsonb language sql immutable as $$
 select case p_plan
  when 'business' then jsonb_build_object('cards',15,'clients',5000,'staff',20,'notifications',5000,'geolocation',true)
  when 'pro' then jsonb_build_object('cards',5,'clients',1000,'staff',5,'notifications',1000,'geolocation',true)
  when 'basic' then jsonb_build_object('cards',1,'clients',100,'staff',1,'notifications',100,'geolocation',false)
  else jsonb_build_object('cards',1,'clients',3,'staff',1,'notifications',3,'geolocation',false)
 end;
$$;

create or replace function public.rewards_my_billing()
returns table(plan text,status text,current_period_end timestamptz,cancel_at_period_end boolean,limits jsonb)
language plpgsql security definer set search_path=public as $$
declare b public.rewards_businesses%rowtype;
begin
 select * into b from public.rewards_businesses where owner_id=auth.uid() limit 1;
 if b.id is null then raise exception 'No se encontró el negocio.'; end if;
 return query select b.rewards_plan,b.subscription_status,b.subscription_current_period_end,b.subscription_cancel_at_period_end,public.rewards_plan_limits(b.rewards_plan);
end $$;

grant execute on function public.rewards_my_billing() to authenticated;

-- Límite de tarjetas incluso si se intenta saltar el frontend.
create or replace function public.rewards_enforce_program_limit() returns trigger language plpgsql as $$
declare b public.rewards_businesses%rowtype; lim int; used int;
begin
 select * into b from public.rewards_businesses where id=new.business_id;
 lim := (public.rewards_plan_limits(coalesce(b.rewards_plan,'trial'))->>'cards')::int;
 select count(*) into used from public.rewards_loyalty_programs where business_id=new.business_id;
 if tg_op='INSERT' and used >= lim then raise exception 'Tu plan permite un máximo de % tarjeta(s).',lim; end if;
 if coalesce(b.rewards_plan,'trial')='trial' then new.publication_status:='draft'; end if;
 return new;
end $$;
drop trigger if exists rewards_program_limit_trigger on public.rewards_loyalty_programs;
create trigger rewards_program_limit_trigger before insert on public.rewards_loyalty_programs for each row execute function public.rewards_enforce_program_limit();

-- Máximo de clientes por negocio/plan. En prueba son 3 clientes totales para que no pueda operarse gratis.
create or replace function public.rewards_enforce_customer_limit() returns trigger language plpgsql as $$
declare bid uuid; pl text; lim int; used int;
begin
 select p.business_id into bid from public.rewards_loyalty_programs p where p.id=new.program_id;
 select coalesce(b.rewards_plan,'trial') into pl from public.rewards_businesses b where b.id=bid;
 lim := (public.rewards_plan_limits(pl)->>'clients')::int;
 select count(*) into used from public.rewards_customers c join public.rewards_loyalty_programs p on p.id=c.program_id where p.business_id=bid and coalesce(c.status,'active') <> 'deleted';
 if tg_op='INSERT' and used >= lim then raise exception 'Tu plan permite un máximo de % clientes.',lim; end if;
 return new;
end $$;
drop trigger if exists rewards_customer_limit_trigger on public.rewards_customers;
create trigger rewards_customer_limit_trigger before insert on public.rewards_customers for each row execute function public.rewards_enforce_customer_limit();

-- Trial: una sola tarjeta en borrador y hasta 3 clientes. Solo un plan pagado puede publicar.
create or replace function public.rewards_publish_program(p_program_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare b public.rewards_businesses%rowtype;
begin
 select b.* into b from public.rewards_businesses b join public.rewards_loyalty_programs p on p.business_id=b.id where p.id=p_program_id and b.owner_id=auth.uid();
 if b.id is null then raise exception 'Tarjeta no encontrada.'; end if;
 if b.rewards_plan='trial' or b.subscription_status not in ('active','trialing') then raise exception 'Elige un plan para publicar tu tarjeta.'; end if;
 update public.rewards_loyalty_programs set publication_status='published',published_at=coalesce(published_at,now()) where id=p_program_id;
 return true;
end $$;
grant execute on function public.rewards_publish_program(uuid) to authenticated;

-- Los webhooks usan service_role y actualizan estas columnas directamente.
create index if not exists rewards_businesses_stripe_customer_idx on public.rewards_businesses(stripe_customer_id);
create index if not exists rewards_businesses_stripe_subscription_idx on public.rewards_businesses(stripe_subscription_id);
