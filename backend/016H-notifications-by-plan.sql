-- Ejecutar después de 015A y 016G. Restringe envíos personalizados también en el servidor.
-- No cambia geolocalización ni el diseño de las tarjetas.

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
  v_plan text;
  v_subscription_status text;
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

  select b.rewards_plan, b.subscription_status into v_plan, v_subscription_status
  from public.rewards_businesses b where b.id = v_business;
  if coalesce(v_plan,'trial') not in ('pro','business')
     or coalesce(v_subscription_status,'') not in ('active','trialing') then
    raise exception 'Las notificaciones personalizadas requieren un plan Pro o Negocio activo.';
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
      wallet_notification_sent_at = now(),
      apple_updated_at = greatest(
        coalesce(c.apple_updated_at, 0) + 1,
        (extract(epoch from clock_timestamp()) * 1000)::bigint
      )
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
