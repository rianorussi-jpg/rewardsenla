# 012 · Panel contextual y cashback abierto

Ejecuta `012-panel-scope-cashback-adjustments.sql` una sola vez en Supabase SQL Editor.

Este cambio agrega dos RPC seguras:
- `rewards_add_cashback_amount(customer_id, amount)`: suma cualquier monto positivo al saldo.
- `rewards_set_cashback_balance(customer_id, amount)`: corrige el saldo a una cantidad exacta y deja registro como `adjustment`.

Después despliega el proyecto web en Vercel. No hay que modificar las Edge Functions de Apple Wallet, Google Wallet, `wallet-sync` ni `apple-wallet-webservice`; `wallet-sync` seguirá reflejando el nuevo saldo después de cada operación.
