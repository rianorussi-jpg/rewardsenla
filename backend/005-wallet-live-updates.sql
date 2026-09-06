-- Rewards Enla: actualizaciones automáticas de Apple Wallet
-- Ejecuta una sola vez después de 004-apple-wallet.sql.

alter table public.rewards_customers
  add column if not exists apple_auth_token text,
  add column if not exists apple_updated_at bigint;

update public.rewards_customers
set apple_auth_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
where apple_auth_token is null;

update public.rewards_customers
set apple_updated_at = (extract(epoch from clock_timestamp()) * 1000)::bigint
where apple_updated_at is null;

alter table public.rewards_customers
  alter column apple_auth_token set default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  alter column apple_updated_at set default ((extract(epoch from clock_timestamp()) * 1000)::bigint);

create table if not exists public.rewards_apple_registrations (
  id uuid primary key default gen_random_uuid(),
  device_library_identifier text not null,
  push_token text not null,
  pass_type_id text not null,
  serial_number text not null,
  customer_id uuid not null references public.rewards_customers(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_library_identifier, pass_type_id, serial_number)
);

create index if not exists rewards_apple_registrations_customer_idx
  on public.rewards_apple_registrations(customer_id);
create index if not exists rewards_apple_registrations_device_idx
  on public.rewards_apple_registrations(device_library_identifier, pass_type_id);

alter table public.rewards_apple_registrations enable row level security;
-- Sin políticas públicas: solo las Edge Functions con service_role acceden a esta tabla.

create or replace function public.rewards_touch_apple_pass()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.current_value is distinct from old.current_value then
    new.apple_updated_at := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  end if;
  return new;
end;
$$;

drop trigger if exists rewards_touch_apple_pass_on_customer on public.rewards_customers;
create trigger rewards_touch_apple_pass_on_customer
before update of current_value on public.rewards_customers
for each row execute function public.rewards_touch_apple_pass();
