# Actualizaciones automáticas — Apple Wallet + Google Wallet

## 1) SQL
Ejecuta `backend/005-wallet-live-updates.sql` una sola vez.

## 2) Reemplaza `apple-wallet-pass`
Vuelve a desplegar la función `apple-wallet-pass` de este proyecto (Verify JWT OFF). Ahora el pase incluye `webServiceURL` y `authenticationToken`, que permiten a Wallet registrarse para recibir cambios.

**Importante:** los pases Apple que ya estaban instalados antes de este cambio no tienen `webServiceURL`. Elimínalos del iPhone y agrégalos de nuevo una vez.

## 3) Crea `apple-wallet-webservice`
Despliega `supabase/functions/apple-wallet-webservice` con **Verify JWT OFF**. Apple llama directamente a esta función para registrar el dispositivo, preguntar qué pases cambiaron y descargar el `.pkpass` nuevo.

## 4) Crea `wallet-sync`
Despliega `supabase/functions/wallet-sync` con **Verify JWT ON**. El panel la invoca después de sumar un sello. Esta función:
- actualiza el LoyaltyObject de Google Wallet;
- manda el aviso de actualización a los iPhone que tengan el pase instalado.

## 5) Dos secretos nuevos para APNs
Ya tienes `APPLE_TEAM_ID` y `APPLE_PASS_TYPE_ID`. Agrega también:
- `APPLE_APNS_KEY_ID`
- `APPLE_APNS_PRIVATE_KEY`

La private key es el contenido completo del archivo `.p8` de una Apple Push Notifications key. No la pongas en GitHub ni en el frontend.

Sin esos dos secretos, Google se actualizará automáticamente y Apple podrá registrar los pases, pero no recibirá el aviso inmediato de que debe descargar la versión nueva.
