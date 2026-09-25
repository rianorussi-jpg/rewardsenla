# Rewards Enla · Promoción anual de apertura

## Precios

- Básico mensual: $149 MXN / mes
- Básico anual promocional: $999 MXN / año
- Pro mensual: $249 MXN / mes
- Pro anual promocional: $1,494 MXN / año (50% menos / 6 meses gratis)
- Negocio mensual: $499 MXN / mes
- Negocio anual promocional: $2,994 MXN / año (50% menos / 6 meses gratis)

La promoción anual está limitada en Supabase a los primeros 50 negocios. Una reserva de checkout dura 35 minutos; el Checkout anual de Stripe expira aproximadamente a los 31 minutos para evitar que una sesión abandonada bloquee permanentemente un lugar.

## 1. Stripe

Usa los mismos tres productos existentes (Básico, Pro y Negocio). Dentro de cada producto crea un precio recurrente nuevo con intervalo **Yearly / Annual**:

- Básico: MXN $999 cada año
- Pro: MXN $1,494 cada año
- Negocio: MXN $2,994 cada año

No hace falta crear cupones ni Promotion Codes para estos precios: el descuento ya está incorporado en el precio anual.

Copia los tres nuevos `price_...`.

En el webhook de producción conserva los eventos actuales y agrega también:

- `checkout.session.expired`

Debe seguir escuchando al menos:

- `checkout.session.completed`
- `checkout.session.expired`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

## 2. Supabase SQL

Ejecuta:

`backend/016K-annual-opening-promo.sql`

Esto crea el control de los 50 lugares y agrega `billing_interval` al negocio.

## 3. Supabase Edge Function Secrets

Conserva los secretos mensuales actuales:

- `STRIPE_PRICE_BASIC`
- `STRIPE_PRICE_PRO`
- `STRIPE_PRICE_BUSINESS`

Agrega:

- `STRIPE_PRICE_BASIC_ANNUAL_PROMO=price_...`
- `STRIPE_PRICE_PRO_ANNUAL_PROMO=price_...`
- `STRIPE_PRICE_BUSINESS_ANNUAL_PROMO=price_...`

No cambies `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` ni `APP_URL`.

## 4. Edge Functions

Vuelve a desplegar:

- `create-checkout-session` — Verify JWT ON
- `stripe-webhook` — Verify JWT OFF

## 5. Frontend

Despliega en Vercel:

- `index.html`
- `app/billing.html`
- `app/assets/app.js`

## Comportamiento de la promoción

- Solo cuenta un negocio una vez, aunque cambie de plan anual.
- Un negocio que ya obtuvo uno de los primeros 50 lugares queda identificado como parte de la promoción y conserva el acceso a esos precios anuales.
- Las sesiones anuales abandonadas liberan el lugar al expirar.
- Cuando se ocupen los 50 lugares, el backend impide nuevas contrataciones anuales promocionales aunque alguien intente saltarse el frontend.
- Los precios mensuales siguen funcionando igual.
