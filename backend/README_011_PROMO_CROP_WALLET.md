# 011 · Recorte de imagen promocional para Wallet

No requiere SQL nuevo.

## Frontend
Al seleccionar la imagen promocional se abre un editor con relación 375:123. El usuario puede arrastrar y hacer zoom. Al confirmar, el navegador genera un JPG de 1500x492 y esa versión recortada es la que se sube a Storage.

## Apple Wallet
Reemplaza la Edge Function `apple-wallet-pass` por la versión incluida en este proyecto. `Verify JWT` debe seguir desactivado.

Apple Wallet no admite un background degradado nativo para todo el pase. `backgroundColor` solo acepta un color sólido. Esta versión mezcla el color principal y secundario para que el fondo sólido se acerque al degradado elegido, mientras que la imagen promocional llena por completo la franja central.
