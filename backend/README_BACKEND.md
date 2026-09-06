# Backend de rewards.enla

> **Base compartida con EnlaceCorto:** este proyecto usa tablas separadas con prefijo `rewards_` para no mezclarlas con las del acortador. También usa un trigger y función exclusivos de Rewards para no sobrescribir lógica existente de `auth.users`.


## 1) Supabase
1. Crea un proyecto nuevo de Supabase para Rewards (recomendado para mantenerlo separado de Sites/Links).
2. En **SQL Editor**, ejecuta `backend/supabase-schema.sql` completo.
3. En **Authentication > URL Configuration** agrega tus URLs de producción y local, por ejemplo `https://rewards.enla.mx/app/dashboard.html`.
4. Copia **Project URL** y **anon public key** y reemplázalas en `app/assets/config.js`.
5. Activa Email/Password en Authentication. Si quieres que entren inmediatamente en pruebas, puedes desactivar temporalmente la confirmación de email; para producción conviene dejarla activa.

Con eso ya funcionan: registro, login, negocio automático, personalización del programa, carga de logo, clientes, sellos y movimientos.

## 2) Google Wallet (NO pongas credenciales en config.js)
Tu Issuer ID de Google Wallet debe guardarse como secreto del backend. Crea una Service Account en Google Cloud, habilita Google Wallet API y agrega el correo de esa Service Account como usuario de tu cuenta de emisor de Wallet.

En Supabase Edge Functions guarda como secrets, por ejemplo:
- `GOOGLE_WALLET_ISSUER_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON`

Crea dos funciones servidoras:
- `google-create-class`: crea/actualiza una LoyaltyClass por negocio y guarda `google_class_id` en `rewards_loyalty_programs`.
- `google-create-object`: crea un LoyaltyObject por cliente y guarda `google_object_id` en `rewards_customers`; devuelve el enlace/JWT de **Add to Google Wallet**.

Nunca firmes el JWT de Google Wallet en el frontend.

## 3) Apple Wallet
Necesitarás en Apple Developer:
- Pass Type ID (por ejemplo `pass.mx.enla.rewards`)
- Certificado de Pass Type ID (.p12)
- Team ID

Guarda certificado/contraseña/Team ID como secretos de backend. Una función `apple-create-pass` debe generar y firmar el `.pkpass`, crear un serial por cliente y guardar `apple_serial_number`.

## 4) Página pública del cliente
El panel ya guarda `rewards_businesses.slug`. La siguiente pieza de producción es una ruta pública como `/r/mi-negocio` donde:
1. El cliente escribe nombre/teléfono/email.
2. Se crea un registro en `rewards_customers` mediante una Edge Function pública con validación/rate limit (NO abras INSERT anónimo directo a la tabla).
3. Se muestran los botones Apple Wallet / Google Wallet llamando a las funciones servidoras.
4. El QR del pase debe contener `public_code` o una URL firmada, no el id interno de la base.

## 5) Seguridad recomendada antes de venderlo
- Mantén RLS activado (el SQL ya lo hace).
- Las llaves privadas de Apple/Google solo viven en Edge Functions/secrets.
- Añade rate limiting a registro público y escaneo.
- Registra cada cambio de puntos/sellos en `rewards_loyalty_transactions`.
- Para evitar fraude, idealmente el incremento de sellos se hace vía una función RPC/Edge Function que valide que el usuario pertenece al negocio, en vez de actualizar `rewards_customers.current_value` directamente desde el navegador.
- Antes de producción, reemplaza la actualización directa de sellos por esa función segura.

## 6) Sin modo demo
El frontend requiere Supabase para funcionar. Si `app/assets/config.js` no tiene credenciales válidas o Supabase devuelve un error, el sistema muestra ese error y no crea cuentas ni datos locales. No existe fallback a `localStorage`.
