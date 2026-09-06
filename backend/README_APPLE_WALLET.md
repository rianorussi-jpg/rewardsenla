# Apple Wallet · Enla Rewards

## Secretos requeridos en Supabase

- `APPLE_PASS_TYPE_ID` = `pass.mx.enla.rewards`
- `APPLE_TEAM_ID` = tu Team ID
- `APPLE_PASS_CERTIFICATE_BASE64` = contenido Base64 completo del `.p12`
- `APPLE_PASS_CERTIFICATE_PASSWORD` = contraseña del `.p12`

Nunca pongas el `.p12`, su contraseña ni el Base64 en GitHub o en `app/assets/config.js`.

## Crear la Edge Function

1. Supabase → Edge Functions → Create function.
2. Nombre exacto: `apple-wallet-pass`.
3. Copia `supabase/functions/apple-wallet-pass/index.ts`.
4. Desactiva **Verify JWT** para esta función, ya que el enlace del cliente es público y la función valida la tarjeta por su `public_code`.
5. Deploy.

La función genera un `.pkpass` firmado en el momento usando los datos reales del programa y del cliente. También guarda `apple_serial_number` si todavía no existe.

## Prueba

Abre una tarjeta pública desde un iPhone con Safari y toca ** Agregar a Apple Wallet**.

Si el navegador muestra JSON con un error en vez del pase, revisa los logs de `apple-wallet-pass` en Supabase y copia únicamente el mensaje de error, nunca certificados o secretos.

## Nota sobre actualizaciones automáticas

Esta primera integración genera e instala el pase correctamente. Para que un pase ya instalado cambie automáticamente cuando el negocio agregue un sello, todavía hace falta implementar el web service de actualización de PassKit y notificaciones push de Apple. Hasta entonces, al volver a descargar el mismo pase (mismo `passTypeIdentifier` + `serialNumber`) se genera con el progreso más reciente.
