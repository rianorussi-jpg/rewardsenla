-- Rewards Enla · Geolocalización + notificaciones por tarjeta

alter table public.rewards_loyalty_programs
  add column if not exists geo_enabled boolean not null default false,
  add column if not exists geo_latitude double precision,
  add column if not exists geo_longitude double precision,
  add column if not exists geo_message text,
  add column if not exists geo_location_name text;

alter table public.rewards_customers
  add column if not exists wallet_notification_message text,
  add column if not exists wallet_notification_nonce text,
  add column if not exists wallet_notification_sent_at timestamptz,
  add column if not exists google_notification_sent_nonce text;

create table if not exists public.rewards_notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.rewards_businesses(id) on delete cascade,
  program_id uuid not null references public.rewards_loyalty_programs(id) on delete cascade,
  customer_id uuid references public.rewards_customers(id) on delete set null,
  message text not null,
  audience text not null default 'all' check (audience in ('all','customer')),
  recipient_count integer not null default 0,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.rewards_notifications enable row level security;
grant select on table public.rewards_notifications to authenticated;

drop policy if exists "rewards_notifications_owner_select" on public.rewards_notifications;
create policy "rewards_notifications_owner_select"
on public.rewards_notifications for select
to authenticated
using (
  exists (
    select 1 from public.rewards_businesses b
    where b.id = rewards_notifications.business_id and b.owner_id = auth.uid()
  )
);

create or replace function public.rewards_send_wallet_notification(
  p_program_id uuid,
  p_message text,
  p_customer_id uuid default null
)
returns table(public_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business uuid;
  v_nonce text;
  v_count integer;
begin
  if length(trim(coalesce(p_message,''))) < 2 then
    raise exception 'Escribe un mensaje para la notificación.';
  end if;
  if length(p_message) > 180 then
    raise exception 'El mensaje puede tener máximo 180 caracteres.';
  end if;

  select p.business_id into v_business
  from public.rewards_loyalty_programs p
  join public.rewards_businesses b on b.id = p.business_id
  where p.id = p_program_id and b.owner_id = auth.uid();

  if v_business is null then
    raise exception 'No tienes permiso para enviar notificaciones desde esta tarjeta.';
  end if;

  if p_customer_id is not null and not exists (
    select 1 from public.rewards_customers c
    where c.id = p_customer_id and c.program_id = p_program_id and c.business_id = v_business
  ) then
    raise exception 'El cliente no pertenece a esta tarjeta.';
  end if;

  v_nonce := replace(gen_random_uuid()::text,'-','');

  update public.rewards_customers c
  set wallet_notification_message = trim(p_message),
      wallet_notification_nonce = v_nonce || '-' || c.id::text,
      wallet_notification_sent_at = now()
  where c.program_id = p_program_id
    and c.business_id = v_business
    and coalesce(c.status,'active') <> 'inactive'
    and (p_customer_id is null or c.id = p_customer_id);

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'No hay clientes activos para recibir la notificación.';
  end if;

  insert into public.rewards_notifications(business_id,program_id,customer_id,message,audience,recipient_count,created_by)
  values(v_business,p_program_id,p_customer_id,trim(p_message),case when p_customer_id is null then 'all' else 'customer' end,v_count,auth.uid());

  return query
  select c.public_code
  from public.rewards_customers c
  where c.program_id = p_program_id
    and c.business_id = v_business
    and coalesce(c.status,'active') <> 'inactive'
    and (p_customer_id is null or c.id = p_customer_id);
end;
$$;

grant execute on function public.rewards_send_wallet_notification(uuid,text,uuid) to authenticated;

create or replace function public.rewards_program_customer_codes(p_program_id uuid)
returns table(public_code text)
language sql
security definer
set search_path = public
as $$
  select c.public_code
  from public.rewards_customers c
  join public.rewards_loyalty_programs p on p.id = c.program_id
  join public.rewards_businesses b on b.id = p.business_id
  where p.id = p_program_id
    and b.owner_id = auth.uid()
    and coalesce(c.status,'active') <> 'inactive';
$$;
grant execute on function public.rewards_program_customer_codes(uuid) to authenticated;
