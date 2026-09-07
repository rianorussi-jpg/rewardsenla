# 014 — Empleados por tarjeta y acceso dinámico
1. Ejecuta `014-program-staff-access-control.sql` después de 013.
2. Despliega el proyecto web.
3. Reemplaza `apple-wallet-pass` y `google-wallet-pass` por las versiones entregadas.

## Empleados por tarjeta
El dueño agrega el correo del empleado desde **Tarjeta > Empleados**. El empleado inicia sesión/crea su cuenta con ese mismo correo. Su permiso es únicamente operativo sobre esa tarjeta: escanear y registrar la acción correspondiente. No puede editar configuración, clientes, vencimientos ni saldo manual.

## Identificación / Acceso
Al crearla se elige **Clientes** (membresía/acceso ilimitado) o **Empleados** (entrada/salida). En Clientes se puede editar vencimiento, suspender y reactivar.

## Código dinámico
Las credenciales de Identificación/Acceso usan `dynamic_code`. Después de cada acceso validado se genera uno nuevo y se solicita sincronización de Wallet. El código público permanece como identificador alterno/administrativo.
