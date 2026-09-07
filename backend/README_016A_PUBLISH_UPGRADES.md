# 016A — Borradores, publicación y upgrades

1. Ejecuta `backend/016A-drafts-and-published-limits.sql` después de 016.
2. Vuelve a desplegar `create-checkout-session` (Verify JWT ON).
3. Haz deploy del proyecto en Vercel.
4. No hace falta volver a desplegar stripe-webhook ni create-customer-portal.

Comportamiento:
- Todos pueden crear hasta 15 tarjetas como borrador.
- Sin plan: 0 publicadas.
- Básico: 1 publicada. Pro: 5. Negocio: 15.
- `Publicar` publica directamente si hay cupo. Si no hay plan/cupo abre Plan y facturación.
- El plan actual se marca siempre.
- Upgrade de un plan activo modifica la suscripción existente con prorrateo de Stripe; no crea otra.
- `Apagar tarjeta` la vuelve a borrador y libera un espacio.
