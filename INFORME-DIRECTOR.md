# INFORME EJECUTIVO DE AVANCES Y ESTADO DEL SISTEMA — TOCINETA ERP
**Fecha:** {{FECHA}}
**Rama:** {{RAMA}}

## 1. Resumen de Avances y Blindaje Operativo

El sistema ha completado satisfactoriamente los hitos de seguridad, consistencia contable y estabilización de la operativa diaria:

- **Ola A (Finanzas, Métodos de Pago y Cuadre Exacto):**
  - **Moneda nativa por método:** Respeto estricto de la divisa de origen (Pago Móvil en Bs, Zelle en USD, Efectivo dual).
  - **Separación de terminales:** Desglose independiente de Punto de Venta y UBI.
  - **Nuevo método TRANSFERENCIA:** Soporte de transferencias bancarias en Bs según requerimiento operativo.
  - **Migración 0039:** Base de datos alineada con el modelo contable de auditoría sin discrepancias (0 centavos de descuadre entre comanda, arqueo y reportes).

- **Ola B (Cierre Z, Operación de Caja y Menú):**
  - **Cierre Z:** Flujo guiado y arqueo ciego estabilizados, eliminando bucles y permitiendo a la cajera cerrar turno con generación y descarga formal de comprobantes en PDF y Excel con autenticación.
  - **KDS (Cocina y Barra):** Barra libre y estaciones de preparación funcionando con sincronización en tiempo real e inmutabilidad de comandas.
  - **Carta y Menú:** Buscador interactivo, avisos de disponibilidad y soporte de sabores de malteadas (Brownie, Flips, Nucita, Ovomaltina, Samba, Oreo).

## 2. Deudas Técnicas y Fase C (Excelencia y Embellecimiento)

Componentes planificados para la siguiente fase que no comprometen la integridad transaccional ni el cobro en sala:

- **Flujo Tomar Pedido:** Optimización ergonómica y táctil de la botonera en POS comandero para agilizar la comanda.
- **Ítem Libre:** Capacidad de facturar ítems abiertos con precio y descripción personalizada en mostrador.
- **Ficha Técnica:** Vista consolidada de costo de insumos, rendimiento por porción y recetas.
- **Impresión ESC/POS Nativa:** Conexión directa al Spooler de Windows sin scripts auxiliares para máxima robustez térmica.
- **Reembolsos Auditados:** Reversión exacta por canal hacia el bucket de pago original (Bs / USD).
- **Multi-Sede:** Consolidación de transferencias de inventario entre sedes (Alta Vista y Los Olivos).

## 3. Preguntas para el Director (Definición de Despliegue)

Para proceder con el empaquetado definitivo del instalador de producción en Windows, se requiere validar:

1. **Ruta de Instalación:** ¿En qué ruta o partición de disco (ejemplo: `C:\Tocineta\`) se instalará el servidor en la PC principal?
2. **IP Fija en Red Local:** ¿La PC servidor dispondrá de una dirección IP estática/fija (ejemplo: `192.168.1.50`) para garantizar la conexión constante de comandereas y tablets?
3. **Wi-Fi (AP Isolation):** ¿El router del establecimiento tiene deshabilitada la función de *AP Isolation* para permitir el tráfico entre dispositivos móviles y el servidor?
4. **Impresoras Windows:** ¿Se utilizarán 1 o 2 impresoras térmicas (Caja y Despacho/Cocina)? ¿Cuáles son sus nombres exactos registrados en Windows?
