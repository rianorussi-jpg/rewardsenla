-- Enla Cards · 016Q · Invitaciones de empleados + aceptación en Scan
-- Ejecutar después de 016O / migraciones actuales de Scan.

alter table public.rewards_program_staff
  drop constraint if exists rewards_program_staff_status_check;

alter table public.rewards_program_staff
  add constraint rewards_program_staff_status_check
  check(status in ('pending','active','inactive'));

create or replace function public.rewards_add_program_staff(
  p_program_id uuid,
  p_email text
)
returns public.rewards_program_staff
language plpgsql
security definer
set search_path=public
as $$
declare
  r public.rewards_program_staff;
  b uuid;
  em text := lower(trim(coalesce(p_email,'')));
begin
  if em='' or em not like '%@%.%' then
    raise exception 'Escribe un correo válido.';
  end if;

  select p.business_id
    into b
    from public.rewards_loyalty_programs p
    join public.rewards_businesses x on x.id=p.business_id
   where p.id=p_program_id
     and x.owner_id=auth.uid();

  if b is null then
    raise exception 'Sin permiso.';
  end if;

  insert into public.rewards_program_staff(program_id,business_id,email,user_id,status)
  values(p_program_id,b,em,null,'pending')
  on conflict(program_id,email)
  do update set
    status=case when rewards_program_staff.status='active' then 'active' else 'pending' end,
    user_id=case when rewards_program_staff.status='active' then rewards_program_staff.user_id else null end
  returning * into r;

  return r;
end
$$;
grant execute on function public.rewards_add_program_staff(uuid,text) to authenticated;

create or replace function public.rewards_scan_pending_invitations()
returns table(
  staff_id uuid,
  program_id uuid,
  program_name text,
  display_name text,
  program_type text,
  logo_url text,
  primary_color text
)
language sql
security definer
stable
set search_path=public
as $$
  select s.id,p.id,p.program_name,p.display_name,p.program_type,p.logo_url,p.primary_color
  from public.rewards_program_staff s
  join public.rewards_loyalty_programs p on p.id=s.program_id
  where s.status='pending'
    and auth.uid() is not null
    and lower(s.email)=lower(coalesce(auth.jwt()->>'email',''))
  order by s.created_at desc;
$$;
grant execute on function public.rewards_scan_pending_invitations() to authenticated;

create or replace function public.rewards_accept_staff_invitation(
  p_program_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  em text := lower(coalesce(auth.jwt()->>'email',''));
  n integer := 0;
begin
  if auth.uid() is null or em='' then
    raise exception 'Debes iniciar sesión.';
  end if;

  update public.rewards_program_staff s
     set status='active',
         user_id=auth.uid()
   where s.program_id=p_program_id
     and lower(s.email)=em
     and s.status='pending'
     and (s.user_id is null or s.user_id=auth.uid());

  get diagnostics n=row_count;
  if n>0 then return true; end if;

  if exists(
    select 1 from public.rewards_program_staff s
    where s.program_id=p_program_id
      and s.status='active'
      and lower(s.email)=em
      and (s.user_id=auth.uid() or s.user_id is null)
  ) then
    update public.rewards_program_staff
       set user_id=auth.uid()
     where program_id=p_program_id
       and status='active'
       and lower(email)=em
       and user_id is null;
    return true;
  end if;

  raise exception 'Esta invitación no existe, ya no está pendiente o pertenece a otro correo.';
end
$$;
grant execute on function public.rewards_accept_staff_invitation(uuid) to authenticated;

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
  get diagnostics n=row_count;
  return n;
end
$$;
grant execute on function public.rewards_claim_staff_assignments() to authenticated;
