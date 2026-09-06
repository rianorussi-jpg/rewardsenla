-- 009B · Hotfix goal_count para Cashback
-- Ejecutar una sola vez después de 009A.

-- En Sellos y Visitas la meta debe permanecer entre 2 y 1000.
-- Cashback no usa una meta: su saldo puede crecer libremente, por eso guardamos goal_count = 0.
alter table public.rewards_loyalty_programs
  drop constraint if exists rewards_loyalty_programs_goal_count_check;

-- Normaliza cualquier programa cashback creado en pruebas.
update public.rewards_loyalty_programs
set goal_count = 0
where program_type = 'cashback';

alter table public.rewards_loyalty_programs
  add constraint rewards_loyalty_programs_goal_count_check
  check (
    (program_type = 'cashback' and goal_count = 0)
    or
    (program_type in ('stamps','visits') and goal_count between 2 and 1000)
  );
