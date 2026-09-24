# Rewards Enla · Registro, cumpleaños y geolocalización

1. Ejecuta `backend/016I-birthday-notifications.sql` DESPUÉS de 016G y 016H. No vuelvas a ejecutar migraciones antiguas.
2. Sube `join.html`, `index.html`, `app/billing.html`, `app/notifications.html` y `app/assets/app.js` a Vercel.
3. Despliega `wallet-sync`, `google-wallet-pass` y la nueva función `rewards-birthday-notifications` desde `supabase/functions/`. Conserva `apple-wallet-pass` actual: ya elimina las ubicaciones cuando `geo_enabled=false`.
4. En Supabase Edge Function Secrets establece `BIRTHDAY_CRON_SECRET` en un valor aleatorio de al menos 32 caracteres; debe existir en las funciones `rewards-birthday-notifications` y `wallet-sync`. Nunca lo publiques en el frontend.
5. En Supabase Dashboard → Cron, crea una tarea diaria a las **15:00 UTC** (09:00 horario estándar de Ciudad de México), que ejecute la Edge Function `rewards-birthday-notifications` mediante HTTP POST con `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`, `apikey: <SUPABASE_SERVICE_ROLE_KEY>` y `x-enla-birthday-secret: <BIRTHDAY_CRON_SECRET>`. Mantén las credenciales en Supabase Vault/secretos del servidor, NO en el SQL ni en un navegador. No crees tareas que expongan las llaves en la definición SQL pública. Configura Verify JWT OFF para `rewards-birthday-notifications` (valida las credenciales en código); `wallet-sync` conserva Verify JWT ON.
6. En Notificaciones, activa cumpleaños, escribe el texto y guarda. Los clientes nuevos registrarán nombre, correo, teléfono y nacimiento. Para usuarios ya registrados, pídeles volver a entrar al QR para completar fecha sin perder el pase.
7. Comprueba una tarjeta con fecha de hoy llamando la tarea desde el Cron después de haber agregado el pase al dispositivo. El sistema prepara una vez por año; Apple requiere pase instalado y permiso de Wallet, Google limita el envío de mensajes. Los envíos fallidos de esta versión no se reintentan automáticamente; revisa los logs de la tarea.
8. Al desactivar proximidad, guarda y espera la sincronización; Apple elimina `locations` del pase actualizado y Google envía `merchantLocations: []`. Si algún dispositivo no recibe la actualización, reabre el pase para sincronizarlo.

**Privacidad:** la fecha de nacimiento se usa para felicitaciones, no se expone en los pases públicos. Agrega tu aviso de privacidad y explica la finalidad al registrarse.
