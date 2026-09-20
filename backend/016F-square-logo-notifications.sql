-- Rewards Enla · 016F · Logo cuadrado opcional por tarjeta para Wallet.
-- Ejecutar una vez después de 016E. No modifica los logos horizontales existentes.
ALTER TABLE public.rewards_loyalty_programs
  ADD COLUMN IF NOT EXISTS square_logo_url text;

-- Al cambiar el logo cuadrado, Apple debe volver a descargar y firmar el pase
-- actualizado. El envío de APNs se mantiene a través de wallet-sync.
CREATE OR REPLACE FUNCTION public.rewards_touch_pass_on_square_logo_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.square_logo_url IS DISTINCT FROM OLD.square_logo_url THEN
    UPDATE public.rewards_customers AS c
      SET apple_updated_at = GREATEST(
        COALESCE(c.apple_updated_at, 0) + 1,
        (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint
      )
      WHERE c.program_id = NEW.id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS rewards_program_square_logo_changed ON public.rewards_loyalty_programs;
CREATE TRIGGER rewards_program_square_logo_changed
AFTER UPDATE OF square_logo_url ON public.rewards_loyalty_programs
FOR EACH ROW EXECUTE FUNCTION public.rewards_touch_pass_on_square_logo_change();
