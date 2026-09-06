# Google Wallet · rewards.enla

Ya debes tener estos secretos en Supabase Edge Functions:

- `GOOGLE_WALLET_ISSUER_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`

Supabase proporciona automáticamente `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` a la función.

## 1. Ejecutar migración

En Supabase > SQL Editor, ejecuta UNA vez:

`backend/003-wallet-public-fields.sql`

No vuelvas a ejecutar los schemas anteriores.

## 2. Crear/deployar Edge Function

Nombre exacto:

`google-wallet-pass`

Código:

`supabase/functions/google-wallet-pass/index.ts`

### Desde el Dashboard de Supabase

1. Edge Functions.
2. Deploy a new function / Create function.
3. Nombre: `google-wallet-pass`.
4. Pega el contenido completo de `index.ts`.
5. La tarjeta pública no inicia sesión, por lo que la función debe permitir llamadas públicas. Si el dashboard muestra la opción **Verify JWT**, desactívala para esta función.
6. Deploy.

### Con Supabase CLI

```bash
supabase functions deploy google-wallet-pass --no-verify-jwt
```

## 3. Probar

1. Abre una tarjeta de cliente desde `/card.html?c=CODIGO`.
2. Pulsa `Agregar a Google Wallet`.
3. La primera ejecución crea automáticamente la `LoyaltyClass` del negocio y el `LoyaltyObject` del cliente.
4. Se guardan los IDs en:
   - `rewards_loyalty_programs.google_class_id`
   - `rewards_customers.google_object_id`
5. En modo Demo de Google Wallet el pase puede mostrarse como de prueba; es normal hasta solicitar acceso de publicación.

Cada vez que se suma un sello desde el escáner, el sitio intenta sincronizar el objeto de Google Wallet para actualizar los puntos/sellos del pase ya guardado.

## Seguridad

Nunca pongas la llave privada de Google en `config.js`, GitHub o el frontend. Sólo debe existir como secreto de Edge Functions.
