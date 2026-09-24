-- 016I · Cumpleaños y eliminación real de geolocalización al desactivar.
-- EJECUTAR después de 016H. No modifica las funciones históricas.
ALTER TABLE public.rewards_customers ADD COLUMN IF NOT EXISTS birth_date date;
ALTER TABLE public.rewards_customers ADD COLUMN IF NOT EXISTS birthday_sent_on date;
ALTER TABLE public.rewards_loyalty_programs ADD COLUMN IF NOT EXISTS birthday_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.rewards_loyalty_programs ADD COLUMN IF NOT EXISTS birthday_message text;
ALTER TABLE public.rewards_customers DROP CONSTRAINT IF EXISTS rewards_customers_birth_date_check;
ALTER TABLE public.rewards_customers ADD CONSTRAINT rewards_customers_birth_date_check CHECK (birth_date IS NULL OR (birth_date >= DATE '1900-01-01' AND birth_date <= CURRENT_DATE));
ALTER TABLE public.rewards_loyalty_programs DROP CONSTRAINT IF EXISTS rewards_birthday_message_check;
ALTER TABLE public.rewards_loyalty_programs ADD CONSTRAINT rewards_birthday_message_check CHECK (birthday_message IS NULL OR char_length(birthday_message)<=180);

-- Impedir activar cumpleaños sin plan activo, incluso mediante llamadas directas a la API.
CREATE OR REPLACE FUNCTION public.rewards_check_birthday_plan() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_plan text; v_status text;
BEGIN
 IF NEW.birthday_enabled THEN
   SELECT rewards_plan,subscription_status INTO v_plan,v_status FROM public.rewards_businesses WHERE id=NEW.business_id;
   IF v_plan NOT IN ('basic','pro','business') OR v_status NOT IN ('active','trialing') THEN
     RAISE EXCEPTION 'Las notificaciones de cumpleaños requieren un plan activo.';
   END IF;
   IF length(trim(coalesce(NEW.birthday_message,'')))<2 THEN
     RAISE EXCEPTION 'Escribe un mensaje de cumpleaños.';
   END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS rewards_check_birthday_plan_trigger ON public.rewards_loyalty_programs;
CREATE TRIGGER rewards_check_birthday_plan_trigger BEFORE INSERT OR UPDATE OF birthday_enabled,birthday_message ON public.rewards_loyalty_programs
FOR EACH ROW EXECUTE FUNCTION public.rewards_check_birthday_plan();

-- Nuevo RPC público de alta: fecha obligatoria, correo y teléfono requeridos en la pantalla.
-- Conserva el RPC anterior para que enlaces ya desplegados sigan funcionando durante la migración.
CREATE OR REPLACE FUNCTION public.rewards_join_program_card(
 p_program_slug text,p_name text,p_email text,p_phone text,p_photo_url text,p_birth_date date
) RETURNS TABLE(public_code text,customer_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_business uuid;v_program uuid;v_code text;v_name text;v_type text;v_goal integer;v_initial numeric:=0;v_days integer:=30;
BEGIN
 IF length(trim(coalesce(p_name,'')))<2 THEN RAISE EXCEPTION 'Escribe tu nombre.'; END IF;
 IF nullif(trim(coalesce(p_email,'')),'') IS NULL OR p_email NOT LIKE '%@%.%' THEN RAISE EXCEPTION 'Escribe un correo válido.'; END IF;
 IF nullif(trim(coalesce(p_phone,'')),'') IS NULL THEN RAISE EXCEPTION 'Escribe tu teléfono.'; END IF;
 IF p_birth_date IS NULL OR p_birth_date>current_date OR p_birth_date<DATE '1900-01-01' THEN RAISE EXCEPTION 'Selecciona una fecha de nacimiento válida.'; END IF;
 SELECT p.business_id,p.id,p.program_type,p.goal_count,p.validity_days INTO v_business,v_program,v_type,v_goal,v_days
 FROM public.rewards_loyalty_programs p WHERE (p.public_slug=p_program_slug OR p.id::text=p_program_slug) AND p.status='active' LIMIT 1;
 IF v_program IS NULL THEN RAISE EXCEPTION 'Esta tarjeta no existe o no está activa.'; END IF;
 IF v_type='access' AND nullif(trim(coalesce(p_photo_url,'')),'') IS NULL THEN RAISE EXCEPTION 'Sube una foto para tu identificación.'; END IF;
 SELECT c.public_code,c.name INTO v_code,v_name FROM public.rewards_customers c
 WHERE c.program_id=v_program AND (lower(c.email)=lower(trim(p_email)) OR c.phone=trim(p_phone))
 ORDER BY c.created_at DESC LIMIT 1;
 IF v_code IS NULL THEN
  v_initial:=CASE WHEN v_type='visits' THEN greatest(coalesce(v_goal,1),1) ELSE 0 END;
  INSERT INTO public.rewards_customers(business_id,program_id,name,email,phone,birth_date,current_value,status,photo_url,expires_at,last_access_state)
  VALUES(v_business,v_program,trim(p_name),lower(trim(p_email)),trim(p_phone),p_birth_date,v_initial,'active',
   CASE WHEN v_type='access' THEN p_photo_url ELSE NULL END,
   CASE WHEN v_type='access' THEN now()+make_interval(days=>greatest(coalesce(v_days,30),1)) ELSE NULL END,'out')
  RETURNING rewards_customers.public_code,rewards_customers.name INTO v_code,v_name;
 ELSE
  -- El cliente ya registrado conserva su código y sus sellos; completa sus datos faltantes.
  UPDATE public.rewards_customers c SET birth_date=coalesce(c.birth_date,p_birth_date),email=coalesce(c.email,lower(trim(p_email))),phone=coalesce(c.phone,trim(p_phone))
  WHERE c.program_id=v_program AND c.public_code=v_code;
 END IF;
 RETURN QUERY SELECT v_code,v_name;
END;$$;
GRANT EXECUTE ON FUNCTION public.rewards_join_program_card(text,text,text,text,text,date) TO anon,authenticated;

-- Al modificar la ubicación de una tarjeta, su pase Apple cambia de versión y Wallet puede descargar el pase sin ubicaciones.
CREATE OR REPLACE FUNCTION public.rewards_touch_program_geolocation() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.geo_enabled IS DISTINCT FROM OLD.geo_enabled OR NEW.geo_latitude IS DISTINCT FROM OLD.geo_latitude OR
 NEW.geo_longitude IS DISTINCT FROM OLD.geo_longitude OR NEW.geo_message IS DISTINCT FROM OLD.geo_message THEN
   UPDATE public.rewards_customers SET apple_updated_at=greatest(coalesce(apple_updated_at,0)+1,(extract(epoch from clock_timestamp())*1000)::bigint)
   WHERE program_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS rewards_touch_program_geolocation_trigger ON public.rewards_loyalty_programs;
CREATE TRIGGER rewards_touch_program_geolocation_trigger AFTER UPDATE OF geo_enabled,geo_latitude,geo_longitude,geo_message ON public.rewards_loyalty_programs
FOR EACH ROW EXECUTE FUNCTION public.rewards_touch_program_geolocation();

-- Una marca anual atómica por cliente impide enviar dos felicitaciones por ejecuciones simultáneas.
-- Para nacidos el 29 de febrero, en años no bisiestos se usa el 28 de febrero.
CREATE OR REPLACE FUNCTION public.rewards_claim_birthday_notifications(p_limit integer DEFAULT 100)
RETURNS TABLE(customer_id uuid,public_code text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_today date:=(now() AT TIME ZONE 'America/Mexico_City')::date;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Operación exclusiva del servidor.'; END IF;
 RETURN QUERY
 WITH due AS (
  SELECT c.id,c.program_id,p.birthday_message,p.business_id,b.owner_id
  FROM public.rewards_customers c
  JOIN public.rewards_loyalty_programs p ON p.id=c.program_id AND p.business_id=c.business_id
  JOIN public.rewards_businesses b ON b.id=p.business_id
  WHERE p.birthday_enabled AND p.status='active' AND p.publication_status='published'
   AND b.rewards_plan IN ('basic','pro','business') AND b.subscription_status IN ('active','trialing')
   AND c.status='active' AND c.birth_date IS NOT NULL
   AND (extract(month from c.birth_date)::int=extract(month from v_today)::int AND
    (extract(day from c.birth_date)::int=extract(day from v_today)::int OR
     (extract(month from v_today)::int=2 AND extract(day from v_today)::int=28 AND
      extract(day from c.birth_date)::int=29 AND
      NOT (extract(year from v_today)::int%4=0 AND (extract(year from v_today)::int%100<>0 OR extract(year from v_today)::int%400=0)))))
   AND (c.birthday_sent_on IS NULL OR extract(year from c.birthday_sent_on)::int<>extract(year from v_today)::int)
  ORDER BY c.id LIMIT least(greatest(p_limit,1),100) FOR UPDATE OF c SKIP LOCKED
 ), claimed AS (
  UPDATE public.rewards_customers c SET
   wallet_notification_message=left(due.birthday_message,180),
   wallet_notification_nonce=replace(gen_random_uuid()::text,'-','')||'-'||c.id::text,
   wallet_notification_sent_at=now(), birthday_sent_on=v_today,
   apple_updated_at=greatest(coalesce(c.apple_updated_at,0)+1,(extract(epoch from clock_timestamp())*1000)::bigint)
  FROM due WHERE c.id=due.id
  RETURNING c.id,c.public_code,c.business_id,c.program_id,c.wallet_notification_message
 ), history AS (
  INSERT INTO public.rewards_notifications(business_id,program_id,customer_id,message,audience,recipient_count,created_by)
  SELECT c.business_id,c.program_id,c.id,c.wallet_notification_message,'customer',1,due.owner_id
  FROM claimed c JOIN due ON due.id=c.id
  RETURNING id
 )
 SELECT c.id,c.public_code FROM claimed c;
END;$$;
REVOKE ALL ON FUNCTION public.rewards_claim_birthday_notifications(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rewards_claim_birthday_notifications(integer) TO service_role;
CREATE INDEX IF NOT EXISTS rewards_birthday_customer_idx ON public.rewards_customers(program_id,birth_date,birthday_sent_on) WHERE birth_date IS NOT NULL;
