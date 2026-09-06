# Apple Wallet — imagen promocional central

Esta versión actualiza únicamente la Edge Function `apple-wallet-pass`.

## Qué cambia
- Usa `central_image_url` como `strip.png` de Apple Wallet.
- Genera automáticamente `strip.png`, `strip@2x.png` y `strip@3x.png` con las proporciones correctas para Store Card.
- La imagen se contiene dentro del lienzo en lugar de recortarse, para que se vea completa.
- En Cashback el frente deja de repetir “disponible para gastar”; solo muestra `SALDO $X.XX` y, si existe, la promoción.

## Deploy
Reemplaza la función `apple-wallet-pass` por la versión incluida en:
`supabase/functions/apple-wallet-pass/`

Mantén `Verify JWT` desactivado.

No necesitas ejecutar SQL nuevo.
No necesitas cambiar `apple-wallet-webservice`, `wallet-sync` ni `google-wallet-pass`.

Las tarjetas ya instaladas deberían recibir el nuevo diseño en la siguiente actualización del pase. Para ver el diseño inmediatamente al probar, también puedes volver a abrir la tarjeta desde la web; no es necesario crear un cliente nuevo.
