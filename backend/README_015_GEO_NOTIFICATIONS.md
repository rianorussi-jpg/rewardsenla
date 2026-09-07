# 015 · Geolocalización y notificaciones Wallet

1. Ejecuta `015-geolocation-and-notifications.sql` en Supabase SQL Editor.
2. Haz deploy del proyecto actualizado en Vercel.
3. Reemplaza `apple-wallet-pass` y `google-wallet-pass` por las versiones incluidas en este proyecto.
4. No es necesario cambiar `apple-wallet-webservice` ni `wallet-sync`.

## Geolocalización
En cada tarjeta, entra a **Notificaciones**. Puedes activar proximidad, usar la ubicación actual o introducir latitud/longitud y escribir el mensaje relevante para Apple Wallet.

Apple Wallet usa `locations` + `relevantText`. Google Wallet usa `merchantLocations`; Google decide el texto de la alerta de proximidad, por lo que el mensaje personalizado se muestra como información de la tarjeta pero Google puede usar su propio texto para la alerta cercana.

## Campañas
Desde **Notificaciones** puedes enviar un mensaje a todos los clientes activos o a un cliente concreto. El mensaje se registra en `rewards_notifications` y se sincroniza con los pases instalados.
