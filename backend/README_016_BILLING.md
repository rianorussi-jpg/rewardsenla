# 016 — Planes y Stripe
1. Ejecuta `016-billing-plans.sql`.
2. En Stripe TEST crea 3 productos recurrentes mensuales: Básico $149 MXN, Pro $249 MXN, Negocio $499 MXN. Para probar cobros sin dinero real usa Test mode; no hace falta poner $1.
3. En Supabase Edge Function secrets agrega: `STRIPE_SECRET_KEY` (sk_test...), `STRIPE_PRICE_BASIC`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS`, `STRIPE_WEBHOOK_SECRET`, `APP_URL=https://rewards.enla.mx`.
4. Deploy: `create-checkout-session`, `create-customer-portal`, `stripe-webhook`. Checkout/portal requieren JWT; webhook debe tener Verify JWT OFF.
5. En Stripe Workbench/Webhooks apunta al URL de `stripe-webhook` y escucha: checkout.session.completed, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted.
6. En Customer Portal activa actualización de método de pago, facturas y cancelación.
7. Cuando terminen pruebas, crea los mismos precios en Live mode y cambia los secrets/Price IDs. El código no cambia.
