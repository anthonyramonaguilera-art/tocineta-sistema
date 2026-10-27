# Registro de Datos Demo y Semillas del Sistema TOCINETA

**Fecha de auditoría:** 2026-10-26  
**Propósito:** Identificar todos los datos sembrados (mock/demo/fixtures) que simulan información real de proveedores, clientes, empleados, repartidores, inventario y catálogo para garantizar que ninguna información ficticia o de pruebas contamine la operación de producción.

---

## 1. Proveedores Sembrados (Suppliers)

Provenientes de la migración SQL `0020_valery_treinta_full_erp.sql` (líneas 122-127):

| ID | Nombre del Proveedor | RIF / Teléfono | Categoría | Saldo Deudor Sembrado | Origen / Archivo |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `sup_polar` | Distribuidora Polar Oriente | J-00041372-9 / 0414-8501234 | Bebidas y Maltas | $0.00 | `0020_valery_treinta_full_erp.sql` |
| `sup_pan_guayana` | Panificadora Industrial Guayana | J-31456789-0 / 0424-9123456 | Panadería Brioche y Hot Dog | $0.00 | `0020_valery_treinta_full_erp.sql` |
| `sup_carnes_sf` | Frigorífico & Carnes San Félix | J-40123890-1 / 0412-8765432 | Carnes Prime Smash y Pollo | $150.00 (15000¢) | `0020_valery_treinta_full_erp.sql` |
| `sup_empaques_bolivar` | Distribuidora Envases y Gas Bolívar | J-29876543-2 / 0424-9876543 | Empaques, Papel y Gas Operativo | $0.00 | `0020_valery_treinta_full_erp.sql` |

---

## 2. Clientes y Socios Sembrados (Customers)

Provenientes de `0020_valery_treinta_full_erp.sql` (líneas 129-134) y saneados en `0021_corporate_identity_and_clean_users.sql`:

| ID | Nombre | Teléfono | Cédula / RIF | Dirección | Es Socio | Saldo por Cobrar | Origen |
| :--- | :--- | :--- | :--- | :--- | :---: | :--- | :--- |
| `cust_partner_admin` | Socio Director | 04249728209 | V-17040918 | TOCINETA | Sí (1) | $0.00 | `0020` / `0021` |
| `cust_partner_aliado` | Socio Inversionista / Aliado Operativo | 04148901234 | V-15890123 | Puerto Ordaz, Alta Vista | Sí (1) | $0.00 | `0020_valery_treinta_full_erp.sql` |
| `cust_vip_cliente1` | Cliente Frecuente 1 | 04121234567 | V-20123456 | Torre Movistar piso 4 | No (0) | $0.00 | `0020` / `0021` |

---

## 3. Empleados y Cuentas de Acceso (Users)

Definidos en `apps/server/src/modules/auth/seed-users.ts` y consolidados en la migración `0021_corporate_identity_and_clean_users.sql`:

| ID Canónico | Nombre | Username | Rol Corporativo | PIN Inicial | Contraseña Inicial | Origen |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `usr_admin` | ADMIN | admin | `admin` | `123456` | `admin123` | `seed-users.ts` / `0021` |
| `usr_cajera` | CAJERA | cajera | `cajera` | `1111` | `caja123` | `seed-users.ts` / `0021` |
| `usr_mesero` | MESERO | mesero | `mesonero` | `2222` | `mesero123` | `seed-users.ts` / `0021` |
| `usr_plancha` | PLANCHA | plancha | `cocinero` | `4444` | `plancha123` | `seed-users.ts` / `0021` |
| `usr_despacho` | DESPACHO | despacho | `despachador` | `5555` | `despacho123` | `seed-users.ts` / `0021` |

---

## 4. Repartidores Sembrados (Delivery Drivers)

Provenientes de `0012_delivery_drivers_and_settlement.sql` y normalizados a identificadores genéricos por la migración `0021_corporate_identity_and_clean_users.sql`:

| ID | Nombre Oficial | Teléfono Sembrado | Estado | Origen |
| :--- | :--- | :--- | :---: | :--- |
| `drv_carlos_mora` | REPARTIDOR 1 | 04148523311 | Activo (1) | `0012` / `0021` |
| `drv_jose_ramirez` | REPARTIDOR 2 | 04249112233 | Activo (1) | `0012` / `0021` |
| `drv_miguel_perez` | REPARTIDOR 3 | 04128994455 | Activo (1) | `0012` / `0021` |

---

## 5. Insumos Críticos de Inventario (Supply Items)

Provenientes de `apps/server/src/modules/profitability/inventory.ts` (`CRITICAL_SUPPLIES`):

| ID Insumo | Nombre del Insumo | Unidad | Costo Unitario USD | Stock Inicial Sembrado | Stock Mínimo |
| :--- | :--- | :---: | :---: | :---: | :---: |
| `sup_pan_brioche` | Pan Brioche Hamburguesa | unid | $0.35 (35¢) | 100 | 25 |
| `sup_pan_perro` | Pan de Perro Caliente | unid | $0.25 (25¢) | 100 | 25 |
| `sup_carne_smash` | Medallón Carne Prime Smash (100g) | unid | $0.75 (75¢) | 150 | 40 |
| `sup_tocineta_crispy`| Tocineta Ahumada Premium | kg | $12.00 (1200¢) | 15 | 5 |
| `sup_queso_cheddar` | Queso Cheddar Rebanadas | kg | $8.50 (850¢) | 12 | 4 |
| `sup_salchicha_pollo`| Salchicha Especial de Pollo | unid | $0.40 (40¢) | 100 | 30 |
| `sup_salchicha_polaca`| Salchicha Polaca Ahumada | unid | $0.60 (60¢) | 40 | 15 |
| `sup_pechuga_pollo` | Pechuga de Pollo Crispy | unid | $0.85 (85¢) | 50 | 15 |
| `sup_papas_francesa`| Papas Francesas Congeladas | kg | $2.80 (280¢) | 40 | 10 |
| `sup_gas_operativo` | Gas Operativo Bombona 43kg | unid | $25.00 (2500¢) | 3 | 1 |
| `sup_malta_lata` | Malta Polar Lata 250 ml | unid | $0.65 (65¢) | 48 | 12 |
| `sup_refresco_1lt` | Refresco Pepsi 1 Litro | unid | $0.90 (90¢) | 36 | 10 |

---

## 6. Catálogo y Configuración de Negocio

- **Configuración de Negocio (`business_settings` en `seed-catalog.ts`):**
  - Razón Social: `TOCINETA`
  - RIF Sembrado: `V-17040918-0`
  - Teléfono: `04249728209`
  - Dirección: `Detrás de Torre Movistar, Puerto Ordaz`
  - Pago Móvil: Banesco `04249728209` / `17040918`
- **Catálogo de Productos (`seed-catalog.ts`):**
  - 7 Hot Dogs (Street Dog, Tocineta Dog Parmesano, Doritos Dog Snacks, Jalapeños Dog, Brazil Dog, Chicago Dog, Seattle Dog).
  - 8 Hamburguesas (Americana Deluxe, Texas Mex, Pechuga Cesar, Grill, Nuggets Meat, Miami, New York, Mozarrella).
  - 3 Combos (Combo Street, Combo Clásico, Combo Para Ti).
  - 6 Extras y Raciones (Papas Fritas 150g, Carne Extra, Tocineta Extra, Pepinillo Extra, Jalapeños Extra, Papas Fritas 250g).
  - 4 Bebidas (Refresco 1 Lt, Malta Lata 250 ml, Nestea 22 Oz, Agua Mineral 500 ml).
  - 1 Producto Inactivo / Feature Flag (Malteada Especial Tocineta - `is_active = 0`).
  - 2 Ítems de Cortesía de Cupones (Snacks de Cortesía, Café de Cortesía - `$0.00`).
