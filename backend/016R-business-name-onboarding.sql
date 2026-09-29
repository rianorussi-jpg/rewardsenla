-- Enla Cards: nombre de negocio correcto desde el alta de Auth
-- Ejecutar una vez en Supabase SQL Editor.

create or replace function public.rewards_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_business_name text;
begin
  v_business_name := coalesce(
    nullif(btrim(new.raw_user_meta_data->>'business_name'), ''),
    'Mi negocio'
  );

  insert into public.rewards_businesses(owner_id,business_name)
  values(new.id, v_business_name)
  on conflict (owner_id) do nothing;

  return new;
end;
$$;

drop trigger if exists rewards_on_auth_user_created on auth.users;
create trigger rewards_on_auth_user_created
after insert on auth.users
for each row execute function public.rewards_handle_new_user();
