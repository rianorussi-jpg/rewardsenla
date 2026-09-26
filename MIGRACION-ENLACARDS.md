# Migración de Rewards Enla a enlacards.com

Esta versión cambia el **dominio público principal** a `https://enlacards.com` sin cambiar la marca visible Rewards Enla, la base de datos, los IDs de tarjetas, Stripe, Supabase ni los pases ya emitidos.

## Cambios incluidos en el código

- Landing: `og:url` y canonical apuntan a `https://enlacards.com`.
- Frontend: `PUBLIC_SITE_URL=https://enlacards.com` centraliza los enlaces públicos.
- QR/enlaces nuevos de registro: siempre se generan con `https://enlacards.com/join.html?...`, incluso si se abre una preview de Vercel.
- Plantillas imprimibles: `Powered by enlacards.com`.
- Apple Wallet: el campo de tecnología cambia a `Powered by enlacards.com`.
- Stripe Checkout: fallback de `APP_URL` cambia a `https://enlacards.com`.
- Stripe Customer Portal: fallback de retorno cambia a `https://enlacards.com`.
- Vercel: `vercel.json` redirige permanentemente `rewards.enla.mx/*` y `www.enlacards.com/*` al dominio principal conservando ruta y query string.
- Documentación interna actualizada al dominio nuevo.

## Lo que NO cambia

- Proyecto de Supabase, `SUPABASE_URL`, anon key, service role y Storage.
- Tablas, clientes, sellos, cashback, visitas, historial y códigos públicos.
- Stripe Customer IDs, Subscription IDs, Products y Price IDs.
- Endpoint del webhook de Stripe (`*.supabase.co/functions/v1/stripe-webhook`).
- Pass Type ID/certificados de Apple Wallet y APNs.
- Issuer/Class/Object IDs de Google Wallet.
- Cron de cumpleaños, Vault y `BIRTHDAY_CRON_SECRET`.
- Marca visual Rewards Enla. Esta migración es de dominio, no un rebranding a “Enla Cards”.

## Pasos manuales obligatorios

### 1. Vercel y DNS

1. En el mismo proyecto actual de Vercel agrega `enlacards.com` y `www.enlacards.com`.
2. Configura los DNS exactamente como te los muestre Vercel.
3. Mantén `rewards.enla.mx` conectado al mismo proyecto. **No lo elimines**, porque los QR y enlaces antiguos necesitan llegar a Vercel para ser redirigidos.
4. Despliega este proyecto incluyendo `vercel.json`.
5. Verifica:
   - `https://enlacards.com/` abre el sitio.
   - `https://www.enlacards.com/...` redirige a `https://enlacards.com/...`.
   - `https://rewards.enla.mx/join.html?p=...` redirige a la misma ruta/query en `enlacards.com`.

### 2. Supabase Authentication

En **Authentication → URL Configuration**:

- Site URL: `https://enlacards.com`
- Agrega a Redirect URLs: `https://enlacards.com/**`
- Mantén temporalmente `https://rewards.enla.mx/**` para compatibilidad con enlaces antiguos.

Si personalizaste plantillas de correo y escribiste `rewards.enla.mx` manualmente dentro del HTML del email, cámbialo también. Si usan `{{ .SiteURL }}`, el cambio de Site URL es suficiente.

> Las sesiones del navegador están asociadas al dominio. Los usuarios que estaban logueados en `rewards.enla.mx` tendrán que iniciar sesión una vez en `enlacards.com`. Sus cuentas y datos no se pierden.

### 3. Supabase Edge Function Secrets

Cambia únicamente:

`APP_URL=https://enlacards.com`

No cambies las llaves de Supabase, Stripe, Google Wallet, Apple Wallet ni Birthday Cron.

### 4. Edge Functions que debes volver a desplegar

- `create-checkout-session` — conserva Verify JWT **ON**.
- `create-customer-portal` — conserva Verify JWT **ON**.
- `apple-wallet-pass` — conserva su configuración actual de JWT.

No requieren cambios por el dominio:

- `stripe-webhook`
- `google-wallet-pass`
- `wallet-sync`
- `apple-wallet-webservice`
- `rewards-birthday-notifications`

### 5. Stripe

No recrees Customers, Subscriptions, Products ni Prices.

- El webhook sigue apuntando a Supabase y no cambia.
- Después de cambiar `APP_URL` y desplegar Checkout/Portal, los retornos nuevos van a `https://enlacards.com/app/billing.html`.
- Si en **Stripe Dashboard → Branding / Business details** tienes escrito manualmente `rewards.enla.mx` como sitio web público, actualízalo a `enlacards.com` (esto es presentación, no lógica de cobros).

### 6. Wallet

**Apple Wallet**

- No cambies certificados, Pass Type ID ni APNs.
- `webServiceURL` sigue en Supabase, por lo que los pases existentes continúan sincronizando.
- Los pases nuevos mostrarán `Powered by enlacards.com`.
- Los pases instalados existentes reflejarán ese texto la próxima vez que reciban/consulten una versión actualizada del pase; no necesitan ser recreados.

**Google Wallet**

- No cambia el Issuer ID, Class ID ni Object ID.
- No hay URL `rewards.enla.mx` embebida en la función actual.
- Si en Google Wallet Console configuraste manualmente un sitio web de la marca, actualízalo por presentación.

### 7. QR impresos y enlaces existentes

No los reemplaces. Los QR antiguos que apunten a `rewards.enla.mx` seguirán funcionando gracias a la redirección permanente de Vercel, siempre que mantengas el dominio viejo conectado y su DNS activo.

Los QR nuevos se generan directamente con `enlacards.com` por medio de `PUBLIC_SITE_URL`.

## Checklist después del despliegue

1. Registro e inicio de sesión en `enlacards.com`.
2. Crear una tarjeta y comprobar que el QR generado empiece por `https://enlacards.com/join.html`.
3. Abrir un QR antiguo de `rewards.enla.mx` y confirmar que conserva `?p=...` al redirigir.
4. Registrar un cliente y abrir `/card.html?c=...`.
5. Agregar un pase nuevo a Apple Wallet y Google Wallet.
6. Añadir sello/visita/cashback y comprobar sincronización.
7. Probar geolocalización y notificación personalizada.
8. Probar cumpleaños/Cron sin modificar su configuración.
9. Abrir Plan y facturación y probar Checkout mensual/anual; cancelar una prueba antes de pagar si solo validas la URL.
10. Abrir Customer Portal y confirmar que regresa a `https://enlacards.com/app/billing.html`.
11. Entrar a `https://enlacards.com/adminx/`.

## SQL

**No hay migración SQL necesaria para este cambio de dominio.** Los identificadores y datos existentes permanecen iguales.
