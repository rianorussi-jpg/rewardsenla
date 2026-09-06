-- rewards.enla · Supabase schema
create extension if not exists pgcrypto;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  business_name text not null,
  slug text unique,
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists public.loyalty_programs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses(id) on delete cascade,
  program_name text not null default 'Mi programa Rewards',
  display_name text,
  program_type text not null default 'stamps' check (program_type in ('stamps','points')),
  goal_count integer not null default 6 check (goal_count between 2 and 1000),
  reward_text text not null default 'Recompensa especial',
  promo_text text,
  primary_color text not null default '#4b63f3',
  stamp_icon text not null default '⭐',
  logo_url text,
  apple_enabled boolean not null default true,
  google_enabled boolean not null default true,
  status text not null default 'active' check (status in ('draft','active','paused')),
  google_class_id text,
  apple_pass_type_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  program_id uuid references public.loyalty_programs(id) on delete set null,
  name text not null,
  email text,
  phone text,
  public_code text not null unique default upper(substr(encode(gen_random_bytes(8),'hex'),1,12)),
  current_value numeric not null default 0,
  google_object_id text,
  apple_serial_number text,
  created_at timestamptz not null default now()
);

create table if not exists public.loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  program_id uuid references public.loyalty_programs(id) on delete set null,
  customer_id uuid not null references public.customers(id) on delete cascade,
  type text not null check(type in ('stamp','points','redeem','adjustment')),
  amount numeric not null default 1,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.businesses enable row level security;
alter table public.loyalty_programs enable row level security;
alter table public.customers enable row level security;
alter table public.loyalty_transactions enable row level security;

create policy "owner businesses" on public.businesses for all using (owner_id=auth.uid()) with check (owner_id=auth.uid());
create policy "owner programs" on public.loyalty_programs for all using (business_id in (select id from public.businesses where owner_id=auth.uid())) with check (business_id in (select id from public.businesses where owner_id=auth.uid()));
create policy "owner customers" on public.customers for all using (business_id in (select id from public.businesses where owner_id=auth.uid())) with check (business_id in (select id from public.businesses where owner_id=auth.uid()));
create policy "owner transactions" on public.loyalty_transactions for all using (business_id in (select id from public.businesses where owner_id=auth.uid())) with check (business_id in (select id from public.businesses where owner_id=auth.uid()));

-- Crea automáticamente el negocio al registrarse.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.businesses(owner_id,business_name)
  values(new.id, coalesce(new.raw_user_meta_data->>'business_name','Mi negocio'));
  return new;
end;$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Bucket público para logos
insert into storage.buckets (id,name,public) values ('reward-logos','reward-logos',true) on conflict(id) do update set public=true;
create policy "logo upload own folder" on storage.objects for insert to authenticated with check (bucket_id='reward-logos' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "logo update own folder" on storage.objects for update to authenticated using (bucket_id='reward-logos' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "logos public read" on storage.objects for select using (bucket_id='reward-logos');
