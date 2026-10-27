# Matriz de Auditoría Pantalla por Pantalla — Sistema TOCINETA

**Fecha de auditoría:** 2026-10-26  
**Entorno:** TOCINETA Monorepo (`apps/web`, `apps/server`, `packages/shared`)  
**Criterio de Evaluación:**
- **OK:** Elemento funcional, conectado a su handler, con endpoint activo y persistencia en base de datos.
- **ROTO:** Elemento que arroja error 4xx/5xx, excepción de React o cuelga el hilo.
- **ADORNO:** Elemento visual interactivo que no produce ningún efecto ni persiste en base de datos.
- **DEMO:** Elemento que opera sobre mocks, semillas estáticas o tablas de prototipo sin flujo operacional real.

---

## 1. Análisis de Vistas y Disparo de `ViewErrorBoundary`

### Componente Auditado: `ViewErrorBoundary` en `apps/web/src/App.tsx` (líneas 52-107)
- **Mensaje de Interfaz:** *"Módulo Temporalmente No Disponible — No se pudo descargar la vista seleccionada. Si el dispositivo perdió la señal Wi-Fi del Food Truck, el Comandero sigue 100% operativo sin interrupción."*
- **Botones Disponibles:** *"Reintentar"* y *"Volver al Comandero"*.

### Causas Exactas de Disparo y Stack Trace Identificado:
1. **Fallo de Carga de Módulo Diferido (Dynamic Import Chunk Failure):**
   - **Causa:** Las vistas `CashierView`, `KdsView`, `MenuAdminView`, `StaffManagementView`, `SystemHealthDashboard`, `DeferredPaperView`, `ProfitabilityDashboard` y `QrMenuWebAdminView` están cargadas vía `React.lazy()` (`App.tsx` líneas 12-19).
   - **Mecanismo:** Si el tablet o teléfono del personal pierde la red LAN del Food Truck durante la navegación entre pestañas, el navegador falla al resolver el chunk JS (`TypeError: Failed to fetch dynamically imported module: ./features/...`).
   - **Stack Trace Típico:**
     ```text
     Error: Failed to fetch dynamically imported module: http://localhost:5173/src/features/cashier/CashierView.js
       at async loadChunk (chunk-loader.js)
       at ViewErrorBoundary.componentDidCatch (App.tsx:63:15)
     ```
2. **Excepciones de Renderizado no Controladas en Módulos Complejos:**
   - En `CashierRoleGuard` (`App.tsx:131`), si un usuario no autorizado intenta renderizar `CashierView` sin pasar por la guardia de redirección, el componente no renderiza nada y desvía al fallback.
   - En `ProfitabilityDashboard` y `MenuAdminView`, si un endpoint devuelve un error 500 con cuerpo no parseable o falta un campo de la respuesta JSON (ej. `settings.fiscalPriceMode`), React lanza un error de acceso a propiedad de `undefined` que es atrapado por el ErrorBoundary.

---

## 2. Matriz de Componentes, Elementos, Endpoints y Estados

| Pantalla | Elemento (botón/campo) | Handler | Endpoint | Tabla.columna | Estado | Evidencia |
| :--- | :--- | :--- | :--- | :--- | :---: | :--- |
| **AuthScreen** | Selector de Perfil (Admin, Cajera, etc.) | `handleSelectUser` | N/A | `users.id, users.role` | **OK** | Selecciona perfil y solicita PIN correspondiente. |
| **AuthScreen** | Teclado numérico PIN (0-9, ⌫) | `handleDigitClick` | N/A | N/A (Estado local) | **OK** | Input táctil de PIN de 4 a 6 dígitos con respuesta haptic. |
| **AuthScreen** | Botón "Ingresar" | `handleLogin` | `POST /api/auth/login` | `sessions.token_hash` | **OK** | Emite sesión JWT/bearer y almacena en cookie/localStorage. |
| **AuthScreen** | Modal Cambio de PIN Obligatorio | `handleChangePin` | `POST /api/auth/change-pin` | `users.pin_hash, users.must_change_pin` | **OK** | Se activa si `must_change_pin === 1`, actualiza hash y desbloquea. |
| **AppLayout** | Selector de Sedes ("Unare" / "Alta Vista") | `handleToggleSede` | N/A | `localStorage(tocineta_active_sede)` | **DEMO** | Solo conmuta un texto en localStorage. El backend aún no segmenta almacenes por sede. |
| **AppLayout** | Conmutador `[🟢 Modo Básico]` / `[🟣 Modo Pro]` | `handleToggleUiMode` | N/A | `localStorage(tocineta_ui_mode)` | **OK** | Oculta pestañas avanzadas en modo básico y devuelve a `pos`. |
| **AppLayout** | Botón Modo Claro / Oscuro | `handleToggleTheme` | N/A | `document.classList, localStorage` | **OK** | Alterna clase `.dark` en `<html>` con persistencia. Inicia en Claro (`light`). |
| **AppLayout** | Botón Tasa BCV (Header) | Abre `isBcvModalOpen` | `GET /api/menu/pos` | `exchange_rates.rate_micro_bs` | **OK** | Muestra tasa actual en bolívares por dólar en tiempo real. |
| **AppLayout / Modal BCV** | Input manual de Tasa | `handleSaveManualBcv` | `POST /api/menu/exchange-rate` | `exchange_rates.rate_micro_bs` | **OK** | Actualiza la tasa y recalcula bolívares en toda la aplicación. |
| **AppLayout / Modal BCV** | Botón "Tomar Tasa BCV Oficial" | `handleSyncBcv` | `POST /api/menu/sync-bcv` | `exchange_rates.source = 'BCV_SCRAPER'` | **OK** | Sincroniza tasa oficial desde scraper de internet o fallback seguro. |
| **AppLayout / Soporte** | Botón Soporte (Ícono Llave) | Abre `StartSupportModal`| N/A | N/A | **OK** | Exige PIN de Admin de 6 dígitos para iniciar sesión de 2h. |
| **AppLayout / Soporte** | Botón "Iniciar Modo Soporte" | `handleStartSupport` | `POST /api/support/start` | `support_sessions.id, audit_events` | **OK** | Activa banner de soporte auditado y emite eventos inmutables. |
| **AppLayout / Soporte** | Botón "Finalizar Modo Soporte" | `handleStopSupport` | `POST /api/support/stop` | `support_sessions.revoked_at_ms` | **OK** | Cierra la sesión técnica auditada. |
| **AppLayout** | Botón "Cerrar Sesión" | `logout` | `POST /api/auth/logout` | `sessions.revoked_at_ms` | **OK** | Revoca el token en BD y redirige a `AuthScreen`. |
| **AppLayout** | Botón "Instalar Aplicación" | `handleInstallClick` | N/A | PWA manifest | **OK** | Dispara prompt nativo PWA o modal instructivo. |
| **PosView** | Filtro de Categorías | `setSelectedCategory` | N/A | N/A (Filtro local) | **OK** | Filtra productos táctiles en pantalla móvil. |
| **PosView** | Buscador de Platos | `setSearchQuery` | N/A | N/A (Filtro local) | **OK** | Búsqueda incremental instantánea por nombre o descripción. |
| **PosView** | Botón de Plato Simple | `handleProductClick` | N/A | N/A | **OK** | Agrega plato al pedido con valores base. |
| **PosView / CustomModal** | Modificadores Barra Libre ($0.00) | `handleToggleBarraLibre`| N/A | `order_line_modifiers (extra = 0)` | **OK** | Permite seleccionar tomate, maíz, chimichurri, etc. sin costo. |
| **PosView / CustomModal** | Extras Pagados (Carne, Tocineta) | `handleAddPaidExtra` | N/A | `order_line_modifiers (extra = 100)` | **OK** | Suma $1.00 por extra en comanda y cuenta del cliente. |
| **PosView / ComboModal** | Asistente de Selección de Combos | `handleSelectComboChild`| N/A | `order_lines.line_role = 'COMBO_CHILD'` | **OK** | Asistente guiado de 2 platos + bebida con prorrateo Hamilton. |
| **PosView** | Selector "Salón / Mesa" | `setTableNumber` | N/A | `orders.table_number` | **OK** | Asigna número de mesa para servicio presencial. |
| **PosView** | Selector "Para Llevar (Takeout)" | `setFulfillmentType` | N/A | `orders.fulfillment_type = 'takeout'` | **OK** | Configura empaque para retiro en food truck sin recargo. |
| **PosView** | Selector "Delivery" | `setMotorizadoId` | N/A | `orders.motorizado_id, delivery_fee` | **OK** | Asigna repartidor de flota y tarifa de envío. |
| **PosView** | Campo Cupón de Descuento | `handleApplyCoupon` | `POST /api/coupons/validate`| `coupons.code, used_count` | **OK** | Valida vigencia, disponibilidad de producto y aplica descuento. |
| **PosView** | Botón "Enviar Comanda a Cocina" | `handleSendOrder` | `POST /api/orders` | `orders, order_lines, print_jobs` | **OK** | Guarda orden en estado 'sin_pago'/'enviado' y encola ticket. |
| **PosView** | Outbox Offline | `outbox.ts` | LocalStorage + sync | `orders` | **OK** | Si cae la conexión, encola pedidos y sincroniza al reanudar. |
| **CashierView** | Botón "Abrir Caja / Jornada" | `handleOpenSession` | `POST /api/jornadas/open` | `jornadas.id, cash_sessions.id` | **OK** | Requiere monto inicial en USD/Bs y abre sesión operativa. |
| **CashierView** | Acordeón de Pedidos Pendientes | Desplegable de orden | `GET /api/orders` | `orders, order_lines` | **OK** | Muestra desglose detallado de platos, extras y total a cobrar. |
| **CashierView / MultiMethod** | Input Efectivo USD | `setCashUsd` | `POST /api/orders/:id/pay` | `payments.method = 'EFECTIVO_USD'` | **OK** | Registra pago en dólares efectivo. |
| **CashierView / MultiMethod** | Input Pago Móvil (Bs) | `setPagoMovil` | `POST /api/orders/:id/pay` | `payments.method = 'PAGO_MOVIL'` | **OK** | Valida monto en Bs, referencia y tasa aplicada. |
| **CashierView / MultiMethod** | Input Punto de Venta / Ubii | `setPuntoVenta` | `POST /api/orders/:id/pay` | `payments.method = 'UBII'` | **OK** | Registra cobro con retención de comisión calculada en backend. |
| **CashierView / MultiMethod** | Botón "Vuelto en Bolívares" | `handleQuickBsChange` | `POST /api/orders/:id/pay` | `change_deliveries.change_bs_cents` | **OK** | Calcula vuelto exacto en bolívares a la tasa oficial. |
| **CashierView** | Botón "Arqueo Ciego" | `handleSubmitBlindCount`| `POST /api/cash-sessions/blind-count` | `cash_sessions.blind_usd_cents` | **OK** | Registra conteo físico sin revelar el saldo teórico del sistema. |
| **CashierView** | Botón "Cerrar Jornada / Turno" | `handleCloseJornada` | `POST /api/jornadas/close` | `jornadas.status = 'cerrada'` | **OK** | Genera Reporte Z, calcula descuadre y dispara impresión. |
| **CashierView** | Botón "Gasto de Caja Chica" | `handleCreateExpense` | `POST /api/operating-expenses` | `operating_expenses.id, ledger_entries` | **OK** | Registra egresos de hielo, agua, insumos menores. |
| **CashierView** | Botón "Reembolso / Merma" | `handleRefundIncident` | `POST /api/incidents` | `worker_incidents, ledger_entries` | **OK** | Exige PIN de supervisor/admin, anula pago y genera contra-asiento. |
| **CashierView** | Botón "Liquidación Motorizados" | `handleSettleDriver` | `POST /api/delivery/settle` | `delivery_driver_settlements` | **OK** | Liquida carreras de repartidores en modalidad pass-through. |
| **KdsView** | Filtro de Estación (Plancha/Perros) | `setStationFilter` | N/A | N/A (Filtro local) | **OK** | Segmenta órdenes por estación de cocina física. |
| **KdsView** | Botón "En Preparación" | `handleAdvanceLine` | `PATCH /api/kds/lines/:id` | `order_lines.status = 'preparando'` | **OK** | Actualiza estado y tiempos de preparación en cocina. |
| **KdsView** | Botón "Plato Listo" | `handleReadyLine` | `PATCH /api/kds/lines/:id` | `order_lines.status = 'listo'` | **OK** | Marca ítem listo y si todos están listos avanza la tarjeta. |
| **KdsView** | Botón "Despachar Orden" | `handleDispatch` | `PATCH /api/orders/:id/status`| `orders.fulfillment_status = 'entregado'` | **OK** | Mueve pedido al historial de entregados. |
| **MenuAdminView** | Toggle Disponibilidad (`is_available`)| `handleToggleAvailable`| `PATCH /api/menu/products/:id`| `products.is_available` | **OK** | Desactiva plato agotado instantáneamente en el Comandero. |
| **MenuAdminView** | Edición de Precios USD | `handleSavePrice` | `PATCH /api/menu/products/:id`| `products.price_usd_cents` | **OK** | Actualiza precio base en catálogo. |
| **MenuAdminView** | Feature Flag "Malteadas" | `handleToggleCategory` | `PATCH /api/menu/categories/:id`| `categories.is_active` | **OK** | Mantiene categoría inactiva por defecto hasta lanzamiento. |
| **StaffManagementView** | Otorgar Permiso Temporal | `handleGrantPermission`| `POST /api/staff/grant-permission` | `users.permissions_json, audit_events` | **OK** | Admin otorga cobro temporal a mesero con expiración de turno. |
| **StaffManagementView** | Revocar Permiso Temporal | `handleRevokePermission`| `POST /api/staff/revoke-permission`| `users.permissions_json` | **OK** | Revoca el permiso de inmediato. |
| **ProfitabilityDashboard** | Indicador Utilidad Neta Real | Carga automática | `GET /api/profitability/net-profit` | Cálculos dinámicos | **OK** | Descuenta costo de insumos, comisiones de punto y gastos de caja. |
| **ProfitabilityDashboard** | Actualización Masiva de Costos | `handleBulkUpdateCosts` | `POST /api/profitability/supplies/bulk-update` | `supply_items, supply_cost_history` | **OK** | Actualiza costos de carne, pan, tocineta y guarda historial. |
| **ProfitabilityDashboard** | Conciliación de Inventario | `handleReconcile` | `POST /api/profitability/inventory/reconcile` | `inventory_reconciliations` | **OK** | Compara conteo físico vs consumo teórico Hamilton. |
| **ProfitabilityDashboard** | Pestaña Proveedores | Renderizado de lista | `GET /api/profitability/suppliers` | `suppliers` | **DEMO** | Muestra lista sembrada en migración 0020 sin compras activas. |
| **ProfitabilityDashboard** | Pestaña Clientes / Socios | Renderizado de lista | `GET /api/profitability/customers` | `customers` | **DEMO** | Muestra clientes de ejemplo sin historial real de facturación. |
| **SystemHealthDashboard** | Botón "Test de Impresión" | `handleTestPrint` | `POST /api/printers/test` | `print_jobs` | **OK** | Envía ticket de prueba ESC/POS a impresora térmica. |
| **SystemHealthDashboard** | Botón "Dry-Run Restauración" | `handleDryRun` | `POST /api/backups/dry-run` | `audit_events` | **OK** | Valida integridad y cadena SHA-256 en solo lectura. |
| **SystemHealthDashboard** | Botón "Exportar Respaldo USB" | `handleExportBackup` | `POST /api/backups/export-encrypted` | `backups_log` | **OK** | Exporta `.db.age` cifrado a carpeta de respaldo. |
| **DeferredPaperView** | Formulario Comanda de Papel | `handleSubmitPaperOrder`| `POST /api/emergency/deferred-orders` | `emergency_deferred_orders, orders` | **OK** | Transcribe pedidos manuales emitidos durante caídas de luz. |
| **QrMenuWebAdminView** | Botón "Exportar Menú Estático" | `handleExportStatic` | `POST /api/qr-menu/export-static`| `_system_meta` | **OK** | Genera archivo JSON estático para menú digital web. |
