# Adminx — instalación y alcance

1. Haz una copia de seguridad de la base de datos. Verifica que el proyecto ya tiene las migraciones hasta `016I-birthday-notifications.sql` y `016G-new-plan-quotas.sql` (también `016H`), ejecutadas en el orden correspondiente.
2. Ejecuta `backend/016J-adminx.sql` desde el SQL Editor de tu proyecto en Supabase. La migración busca en `auth.users` a `sanhost987@gmail.com` y autoriza **el ID exacto de esa cuenta**; falla si la cuenta no existe.
3. Sube `adminx/index.html`, `adminx/adminx.css`, `adminx/adminx.js` y `app/billing.html` a Vercel, respetando las rutas. Usa el mismo `app/assets/config.js` de Rewards Enla; no publiques claves secretas.
4. Actualiza las Edge Functions `stripe-webhook` y `create-checkout-session` con los archivos del ZIP (conserva la configuración anterior de JWT: webhook desactivado, checkout activado). Esto evita que Stripe sobrescriba planes de cortesía y evita abrir un checkout desde un plan gratuito otorgado manualmente.
5. Entra a `https://rewards.enla.mx/adminx/` con el usuario habitual `sanhost987@gmail.com` y su contraseña de siempre. No es necesario crear otra cuenta. Si el sitio redirige a login, inicia sesión y vuelve a /adminx/.

## Notas

* Ocultar `/admin` no constituye una protección. Cada RPC exige el ID del administrador almacenado en una tabla RLS sin políticas públicas. Nunca se expone la service role key.
* Los planes de cortesía se asignan sin crear suscripciones ni cargos. El panel **rechaza** cambiar un plan si hay una suscripción Stripe activa/pending vinculada: se gestiona primero en Stripe, sin cancelarla automáticamente desde el panel.
* Transferir mantiene IDs, códigos, saldos, clientes, movimientos, asignaciones de personal e historial de notificaciones. Si el destino carece de cupo o plan activo para una tarjeta publicada, esta pasa a borrador. La configuración de cumpleaños/geolocalización queda desactivada en esa situación y puede reactivarse tras publicar. No se cobra al destinatario automáticamente.
* Las imágenes ya subidas pueden conservar URL en la carpeta de Storage del usuario original. El nuevo dueño debería volver a subirlas si requiere editarlas; la operación NO modifica automáticamente permisos de archivos.
* Los pases Apple/Google ya instalados podrían requerir sincronización o renovación para reflejar cambios en el emisor y la configuración, en especial si se transfieren entre negocios ya publicados. Adminx marca los pases Apple como actualizados, pero **no envía por sí mismo un push** de Wallet. Los saldos y códigos se conservan en la base de datos.
* No se modifican las cuentas de acceso de clientes finales ni sus contraseñas. La pantalla «Negocios y planes» muestra los negocios con sus cantidades de clientes registrados.
