-- 016S · Personalización del registro público de cada tarjeta.
-- Correo siempre obligatorio. Teléfono, fecha de nacimiento e imagen promocional configurables.

ALTER TABLE public.rewards_loyalty_programs
  ADD COLUMN IF NOT EXISTS registration_phone_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS registration_birth_date_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS registration_promo_image_enabled boolean NOT NULL DEFAULT true;

-- Datos públicos de la tarjeta, incluyendo qué campos debe pedir el registro.
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
  google_enabled boolean,
  birthday_enabled boolean,
  registration_phone_enabled boolean,
  registration_birth_date_enabled boolean,
  registration_promo_image_enabled boolean
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
    p.google_enabled,
    COALESCE(p.birthday_enabled,false),
    COALESCE(p.registration_phone_enabled,false),
    COALESCE(p.registration_birth_date_enabled,false),
    COALESCE(p.registration_promo_image_enabled,true)
  FROM public.rewards_loyalty_programs p
  JOIN public.rewards_businesses b ON b.id=p.business_id
  WHERE (
      lower(p.short_code)=lower(trim(p_program_slug))
      OR p.public_slug=p_program_slug
      OR p.id::text=p_program_slug
    )
    AND p.status='active'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.rewards_public_program_card(text) TO anon, authenticated;

-- Nueva versión del alta pública: correo siempre obligatorio y los otros datos dependen de la tarjeta.
DROP FUNCTION IF EXISTS public.rewards_join_program_wallet(text,text,text,text,text,date);

CREATE FUNCTION public.rewards_join_program_wallet(
  p_program_slug text,
  p_name text,
  p_email text,
  p_phone text,
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
  v_phone text := nullif(trim(coalesce(p_phone,'')),'');
  v_verified_email text := lower(trim(coalesce(auth.jwt()->>'email','')));
  v_existing boolean := false;
  v_phone_required boolean := false;
  v_birth_required boolean := false;
BEGIN
  IF length(trim(coalesce(p_name,''))) < 2 THEN
    RAISE EXCEPTION 'Escribe tu nombre.';
  END IF;

  -- El correo nunca se puede desactivar.
  IF v_email = '' OR v_email NOT LIKE '%@%.%' THEN
    RAISE EXCEPTION 'Escribe un correo válido.';
  END IF;

  SELECT
    p.business_id,
    p.id,
    p.program_type,
    p.goal_count,
    p.validity_days,
    COALESCE(p.registration_phone_enabled,false),
    (COALESCE(p.registration_birth_date_enabled,false) OR COALESCE(p.birthday_enabled,false))
  INTO
    v_business,
    v_program,
    v_type,
    v_goal,
    v_days,
    v_phone_required,
    v_birth_required
  FROM public.rewards_loyalty_programs p
  WHERE (
      lower(p.short_code)=lower(trim(p_program_slug))
      OR p.public_slug=p_program_slug
      OR p.id::text=p_program_slug
    )
    AND p.status='active'
  LIMIT 1;

  IF v_program IS NULL THEN
    RAISE EXCEPTION 'Esta tarjeta no existe o no está activa.';
  END IF;

  IF v_phone_required AND (v_phone IS NULL OR length(regexp_replace(v_phone,'\D','','g')) < 7) THEN
    RAISE EXCEPTION 'Escribe un número de teléfono válido.';
  END IF;

  IF v_birth_required AND (
      p_birth_date IS NULL
      OR p_birth_date > current_date
      OR p_birth_date < DATE '1900-01-01'
    ) THEN
    RAISE EXCEPTION 'Escribe una fecha de nacimiento válida.';
  END IF;

  IF p_birth_date IS NOT NULL AND (
      p_birth_date > current_date
      OR p_birth_date < DATE '1900-01-01'
    ) THEN
    RAISE EXCEPTION 'Escribe una fecha de nacimiento válida.';
  END IF;

  IF v_type='access'
     AND nullif(trim(coalesce(p_photo_url,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Sube una foto para tu identificación.';
  END IF;

  -- El correo es la identidad principal del cliente dentro de una tarjeta.
  SELECT c.public_code, c.name
  INTO v_code, v_name
  FROM public.rewards_customers c
  WHERE c.program_id=v_program
    AND lower(c.email)=v_email
  ORDER BY c.created_at DESC
  LIMIT 1;

  v_existing := v_code IS NOT NULL;

  IF v_existing THEN
    IF v_verified_email = '' OR v_verified_email <> v_email THEN
      RAISE EXCEPTION 'CONFIRM_EMAIL';
    END IF;

    UPDATE public.rewards_customers c
    SET
      name = trim(p_name),
      phone = CASE WHEN v_phone_required THEN v_phone ELSE c.phone END,
      birth_date = CASE WHEN v_birth_required THEN p_birth_date ELSE c.birth_date END,
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
      CASE WHEN v_phone_required THEN v_phone ELSE NULL END,
      CASE WHEN v_birth_required THEN p_birth_date ELSE NULL END,
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

GRANT EXECUTE ON FUNCTION public.rewards_join_program_wallet(text,text,text,text,text,date)
TO anon, authenticated;

-- Compatibilidad con una versión anterior del formulario que todavía no enviaba teléfono.
DROP FUNCTION IF EXISTS public.rewards_join_program_wallet(text,text,text,text,date);
CREATE FUNCTION public.rewards_join_program_wallet(
  p_program_slug text,
  p_name text,
  p_email text,
  p_photo_url text DEFAULT NULL,
  p_birth_date date DEFAULT NULL
)
RETURNS TABLE(public_code text, customer_name text, existing_customer boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path=public
AS $$
  SELECT * FROM public.rewards_join_program_wallet(
    p_program_slug,
    p_name,
    p_email,
    NULL::text,
    p_photo_url,
    p_birth_date
  );
$$;
GRANT EXECUTE ON FUNCTION public.rewards_join_program_wallet(text,text,text,text,date)
TO anon, authenticated;

-- El escáner del panel principal acepta teléfono únicamente cuando la tarjeta lo tiene habilitado.
CREATE OR REPLACE FUNCTION public.rewards_scan_lookup(p_code text)
RETURNS SETOF public.rewards_customers
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path=public
AS $$
  SELECT c.*
  FROM public.rewards_customers c
  JOIN public.rewards_loyalty_programs p ON p.id=c.program_id
  JOIN public.rewards_businesses b ON b.id=c.business_id
  WHERE (
      c.public_code=upper(trim(p_code))
      OR c.dynamic_code=upper(trim(p_code))
      OR (
        COALESCE(p.registration_phone_enabled,false)
        AND c.phone IS NOT NULL
        AND length(regexp_replace(trim(p_code),'\D','','g')) >= 7
        AND regexp_replace(c.phone,'\D','','g')=regexp_replace(trim(p_code),'\D','','g')
      )
    )
    AND (b.owner_id=auth.uid() OR public.rewards_is_program_staff(p.id))
  ORDER BY CASE
    WHEN c.public_code=upper(trim(p_code)) OR c.dynamic_code=upper(trim(p_code)) THEN 0
    ELSE 1
  END
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.rewards_scan_lookup(text) TO authenticated;

-- El escáner independiente también puede buscar por teléfono cuando está habilitado.
DROP FUNCTION IF EXISTS public.rewards_scan_search(uuid,text);
CREATE FUNCTION public.rewards_scan_search(
  p_program_id uuid,
  p_query text
)
RETURNS TABLE(
  id uuid,
  program_id uuid,
  name text,
  email text,
  phone text,
  public_code text,
  dynamic_code text,
  current_value numeric,
  status text,
  photo_url text,
  expires_at timestamptz,
  last_access_state text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path=public
AS $$
DECLARE
  q text := trim(coalesce(p_query,''));
  q_digits text := regexp_replace(trim(coalesce(p_query,'')),'\D','','g');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;

  IF NOT public.rewards_scan_has_program_access(p_program_id) THEN
    RAISE EXCEPTION 'No tienes acceso a esta tarjeta.';
  END IF;

  IF q='' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.id,c.program_id,c.name,c.email,c.phone,c.public_code,c.dynamic_code,
    c.current_value,c.status,c.photo_url,c.expires_at,c.last_access_state
  FROM public.rewards_customers c
  JOIN public.rewards_loyalty_programs p ON p.id=c.program_id
  WHERE c.program_id=p_program_id
    AND (
      upper(c.public_code)=upper(q)
      OR upper(coalesce(c.dynamic_code,''))=upper(q)
      OR c.name ilike '%'||q||'%'
      OR coalesce(c.email,'') ilike '%'||q||'%'
      OR (
        COALESCE(p.registration_phone_enabled,false)
        AND c.phone IS NOT NULL
        AND length(q_digits) >= 3
        AND regexp_replace(c.phone,'\D','','g') LIKE '%'||q_digits||'%'
      )
    )
  ORDER BY
    CASE WHEN upper(c.public_code)=upper(q) OR upper(coalesce(c.dynamic_code,''))=upper(q) THEN 0 ELSE 1 END,
    CASE WHEN lower(coalesce(c.email,''))=lower(q) THEN 0 ELSE 1 END,
    CASE WHEN COALESCE(p.registration_phone_enabled,false) AND regexp_replace(coalesce(c.phone,''),'\D','','g')=q_digits THEN 0 ELSE 1 END,
    c.name
  LIMIT 30;
END;
$$;
GRANT EXECUTE ON FUNCTION public.rewards_scan_search(uuid,text) TO authenticated;
