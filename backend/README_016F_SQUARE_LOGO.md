# 016F · Logo cuadrado de notificaciones

1. Ejecutar `016F-square-logo-notifications.sql` antes de desplegar frontend o funciones.
2. Desplegar frontend en Vercel y `apple-wallet-pass` y `google-wallet-pass` en Supabase.
3. Editar una tarjeta existente y agregar el logo cuadrado en Paso 2. Guardar.
4. Para actualizar pases instalados, enviar una notificación de prueba de esa tarjeta desde el panel (activa wallet-sync); Apple puede conservar el icono anterior en caché temporalmente.

Apple: `icon.png`, `icon@2x.png`, `icon@3x.png` se generan con el logo cuadrado; `logo.png` horizontal y diseño de tarjeta se conservan. Si no hay logo cuadrado, sigue apareciendo el icono Enla.

Google: `programLogo` es una propiedad de la clase. Para no cambiar el logo de otras tarjetas del mismo negocio, los pases NUEVOS usan clases individuales por tarjeta. Los pases Google que ya se emitieron con una clase compartida antigua mantienen esa clase y el branding anterior; no se cambian ni se vuelven a emitir sin permiso del usuario. Las notificaciones de Google y su icono exacto los decide Google Wallet.
