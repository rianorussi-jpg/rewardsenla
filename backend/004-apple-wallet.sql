-- Seguro de compatibilidad para instalaciones anteriores.
-- No borra ni reemplaza datos existentes.
alter table public.rewards_customers
  add column if not exists apple_serial_number text;
