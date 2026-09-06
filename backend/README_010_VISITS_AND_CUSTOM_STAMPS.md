# 010 · Paquetes de visitas + sellos personalizados

Ejecuta `010-visits-packages-custom-stamps.sql` después de los SQL anteriores.

Cambios principales:
- `visits` ahora representa **visitas restantes**, no frecuencia acumulada.
- Un cliente nuevo de una tarjeta de visitas inicia con `goal_count` visitas disponibles.
- Cada uso llama `rewards_use_visit()` y resta 1.
- Al llegar a 0 el negocio puede `rewards_renew_visits()` o `rewards_deactivate_visit_card()`.
- Sellos admite imágenes personalizadas para estado marcado y sin marcar.
- Tarjetas de sellos ya no usan imagen promocional central.

También reemplaza las Edge Functions `apple-wallet-pass` y `google-wallet-pass` incluidas en este proyecto para reflejar la nueva semántica en Wallet. `wallet-sync` y `apple-wallet-webservice` no cambian.
