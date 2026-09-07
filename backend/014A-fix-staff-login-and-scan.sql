-- 014A · Fix de empleados: vincular cuenta por email y reforzar acceso de escaneo
-- Ejecutar después de 014-program-staff-access-control.sql

create or replace function public.rewards_claim_staff_assignments()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  n integer := 0;
  em text := lower(coalesce(auth.jwt()->>'email',''));
begin
  if auth.uid() is null or em='' then return 0; end if;
  update public.rewards_program_staff
     set user_id=auth.uid()
   where status='active'
     and lower(email)=em
     and (user_id is null or user_id=auth.uid());
  get diagnostics n = row_count;
  return n;
end$$;
grant execute on function public.rewards_claim_staff_assignments() to authenticated;

-- Mantiene la lectura de tarjetas asignadas independiente de que el usuario
-- también tenga una fila vacía en rewards_businesses creada al registrarse.
create or replace function public.rewards_staff_programs()
returns setof public.rewards_loyalty_programs
language sql
security definer
stable
set search_path=public
as $$
  select distinct p.*
  from public.rewards_loyalty_programs p
  join public.rewards_program_staff s on s.program_id=p.id
  where s.status='active'
    and (
      s.user_id=auth.uid()
      or lower(s.email)=lower(coalesce(auth.jwt()->>'email',''))
    )
  order by p.created_at desc;
$$;
grant execute on function public.rewards_staff_programs() to authenticated;
