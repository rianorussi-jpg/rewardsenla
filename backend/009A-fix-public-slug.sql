-- Hotfix: asegura public_slug para nuevas tarjetas aunque el frontend no lo envíe.
create or replace function public.rewards_generate_program_slug()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.public_slug is null or btrim(new.public_slug) = '' then
    new.public_slug := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  end if;
  return new;
end;
$$;

drop trigger if exists rewards_generate_program_slug_trigger on public.rewards_loyalty_programs;
create trigger rewards_generate_program_slug_trigger
before insert on public.rewards_loyalty_programs
for each row execute function public.rewards_generate_program_slug();

-- Rellena cualquier fila vieja que por alguna razón siga nula antes de mantener NOT NULL.
update public.rewards_loyalty_programs
set public_slug = lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))
where public_slug is null or btrim(public_slug) = '';
