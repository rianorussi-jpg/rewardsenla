# Canjes e historial

1. Ejecuta `006-redemptions-history.sql` una sola vez.
2. Este SQL crea dos RPC autenticadas y atómicas: `rewards_add_stamp` y `rewards_redeem_reward`.
3. Cuando el cliente llega a la meta, ya no se permiten más sellos hasta canjear.
4. Al canjear se crea una transacción `redeem`, se guarda la recompensa en `note` y `current_value` vuelve a 0.
5. `app/history.html` muestra hasta 500 movimientos recientes.
6. Tanto agregar sello como canjear llaman a `wallet-sync`, por lo que Apple Wallet y Google Wallet se actualizan.
