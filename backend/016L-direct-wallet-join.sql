-- Enla Cards · 016L · Registro directo a Wallet + verificación de correo para tarjetas existentes
-- Ejecutar una sola vez en Supabase SQL Editor.
--
-- Este cambio:
-- 1) expone apple_enabled/google_enabled en rewards_public_program_card;
-- 2) crea rewards_join_program_wallet sin teléfono;
-- 3) si el correo YA tiene una tarjeta en este programa, exige una sesión Supabase
--    cuyo JWT tenga ese mismo correo (la pantalla join.html obtiene esa sesión con OTP);
-- 4) si el correo es nuevo, crea la tarjeta directamente.

-- Datos públicos necesarios para decidir qué botón Wallet mostrar.
DROP FUNCTION IF EXISTS public.rewards_public_program_card(text);

CREATE FUNCTION public.rewards_public_program_card(p_program_slug text)
RETURNS TABLE(
  business_name text,
  program_id uuid,
  public_slug text,
  program_name text,
  display_name text,
  program_type text,
  goal_count integer,
  increment_value numeric,
  reward_text text,
  promo_text text,
  primary_color text,
  text_color text,
  secondary_color text,
  card_style text,
  stamp_icon text,
  stamp_filled_image_url text,
  stamp_empty_image_url text,
  logo_url text,
  central_image_url text,
  barcode_format text,
  service_name text,
  validity_days integer,
  access_mode text,
  apple_enabled boolean,
  google_enabled boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path=public
STABLE
AS $$
  SELECT
    b.business_name,
    p.id,
    p.public_slug,
    p.program_name,
    p.display_name,
    p.program_type,
    p.goal_count,
    p.increment_value,
    p.reward_text,
    p.promo_text,
    p.primary_color,
    p.text_color,
    p.secondary_color,
    p.card_style,
    p.stamp_icon,
    p.stamp_filled_image_url,
    p.stamp_empty_image_url,
    p.logo_url,
    CASE WHEN p.program_type='stamps' THEN NULL ELSE p.central_image_url END,
    COALESCE(p.barcode_format,'qr'),
    p.service_name,
    p.validity_days,
    p.access_mode,
    p.apple_enabled,
    p.google_enabled
  FROM public.rewards_loyalty_programs p
  JOIN public.rewards_businesses b ON b.id=p.business_id
  WHERE (p.public_slug=p_program_slug OR p.id::text=p_program_slug)
    AND p.status='active'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.rewards_public_program_card(text) TO anon, authenticated;


DROP FUNCTION IF EXISTS public.rewards_join_program_wallet(text,text,text,text,date);

CREATE FUNCTION public.rewards_join_program_wallet(
  p_program_slug text,
  p_name text,
  p_email text,
  p_photo_url text DEFAULT NULL,
  p_birth_date date DEFAULT NULL
)
RETURNS TABLE(public_code text, customer_name text, existing_customer boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_business uuid;
  v_program uuid;
  v_code text;
  v_name text;
  v_type text;
  v_goal integer;
  v_initial numeric := 0;
  v_days integer := 30;
  v_email text := lower(trim(coalesce(p_email,'')));
  v_verified_email text := lower(trim(coalesce(auth.jwt()->>'email','')));
  v_existing boolean := false;
BEGIN
  IF length(trim(coalesce(p_name,''))) < 2 THEN
    RAISE EXCEPTION 'Escribe tu nombre.';
  END IF;

  IF v_email = '' OR v_email NOT LIKE '%@%.%' THEN
    RAISE EXCEPTION 'Escribe un correo válido.';
  END IF;

  IF p_birth_date IS NULL
     OR p_birth_date > current_date
     OR p_birth_date < DATE '1900-01-01' THEN
    RAISE EXCEPTION 'Escribe una fecha de nacimiento válida.';
  END IF;

  SELECT
    p.business_id,
    p.id,
    p.program_type,
    p.goal_count,
    p.validity_days
  INTO
    v_business,
    v_program,
    v_type,
    v_goal,
    v_days
  FROM public.rewards_loyalty_programs p
  WHERE (p.public_slug=p_program_slug OR p.id::text=p_program_slug)
    AND p.status='active'
  LIMIT 1;

  IF v_program IS NULL THEN
    RAISE EXCEPTION 'Esta tarjeta no existe o no está activa.';
  END IF;

  IF v_type='access'
     AND nullif(trim(coalesce(p_photo_url,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Sube una foto para tu identificación.';
  END IF;

  -- Sólo deduplicamos por correo dentro de ESTA tarjeta/programa.
  SELECT c.public_code, c.name
  INTO v_code, v_name
  FROM public.rewards_customers c
  WHERE c.program_id=v_program
    AND lower(c.email)=v_email
  ORDER BY c.created_at DESC
  LIMIT 1;

  v_existing := v_code IS NOT NULL;

  IF v_existing THEN
    -- No devolvemos el public_code de una tarjeta existente hasta probar
    -- que quien la solicita controla el correo asociado.
    IF v_verified_email = '' OR v_verified_email <> v_email THEN
      RAISE EXCEPTION 'CONFIRM_EMAIL';
    END IF;

    UPDATE public.rewards_customers c
    SET
      name = trim(p_name),
      birth_date = p_birth_date,
      photo_url = CASE
        WHEN v_type='access' AND nullif(trim(coalesce(p_photo_url,'')),'') IS NOT NULL
          THEN p_photo_url
        ELSE c.photo_url
      END
    WHERE c.program_id=v_program
      AND c.public_code=v_code
    RETURNING c.name INTO v_name;

  ELSE
    v_initial := CASE
      WHEN v_type='visits' THEN greatest(coalesce(v_goal,1),1)
      ELSE 0
    END;

    INSERT INTO public.rewards_customers(
      business_id,
      program_id,
      name,
      email,
      phone,
      birth_date,
      current_value,
      status,
      photo_url,
      expires_at,
      last_access_state
    )
    VALUES(
      v_business,
      v_program,
      trim(p_name),
      v_email,
      NULL,
      p_birth_date,
      v_initial,
      'active',
      CASE WHEN v_type='access' THEN p_photo_url ELSE NULL END,
      CASE
        WHEN v_type='access'
          THEN now()+make_interval(days=>greatest(coalesce(v_days,30),1))
        ELSE NULL
      END,
      'out'
    )
    RETURNING
      rewards_customers.public_code,
      rewards_customers.name
    INTO v_code, v_name;
  END IF;

  RETURN QUERY SELECT v_code, v_name, v_existing;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rewards_join_program_wallet(text,text,text,text,date)
TO anon, authenticated;
