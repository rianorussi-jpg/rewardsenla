-- HOTFIX si ya ejecutaste 006-redemptions-history.sql y ves:
-- column reference "current_value" is ambiguous

create or replace function public.rewards_add_stamp(p_customer_id uuid)
returns table(public_code text, current_value numeric, goal_count integer, reward_ready boolean)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_customer public.rewards_customers%rowtype;
  v_goal integer;
  v_new_value numeric;
begin
  select c.* into v_customer
  from public.rewards_customers as c
  join public.rewards_businesses as b on b.id=c.business_id
  where c.id=p_customer_id and b.owner_id=auth.uid()
  for update of c;

  if not found then raise exception 'Cliente no encontrado o sin permiso.'; end if;

  select coalesce(p.goal_count,6) into v_goal
  from public.rewards_loyalty_programs as p
  where p.id=v_customer.program_id;
  v_goal := coalesce(v_goal,6);

  if v_customer.current_value >= v_goal then
    raise exception 'La recompensa ya está lista. Canjéala antes de agregar otro sello.';
  end if;

  update public.rewards_customers as rc
  set current_value = rc.current_value + 1
  where rc.id = p_customer_id
  returning rc.current_value into v_new_value;

  insert into public.rewards_loyalty_transactions
    (business_id,program_id,customer_id,type,amount,note,created_by)
  values
    (v_customer.business_id,v_customer.program_id,v_customer.id,'stamp',1,'Sello agregado',auth.uid());

  return query select v_customer.public_code, v_new_value, v_goal, (v_new_value >= v_goal);
end;
$$;

grant execute on function public.rewards_add_stamp(uuid) to authenticated;
