# ACTA OFICIAL DE ENTREGA, CERTIFICACIÓN Y ACEPTACIÓN FINAL
## SISTEMA DE PUNTO DE VENTA Y GESTIÓN GASTRONÓMICA: "TOCINETA" (VERSIÓN 3.0)

**Fecha de Certificación:** 27 de Octubre de 2026  
**Lugar:** Sede Operativa Principal, Puerto Ordaz, Estado Bolívar, Venezuela  
**Versión de Entrega:** Release 3.0 — Fases 1 a 7 Completadas  

---

### COMPARECIENTES

De una parte:
**LA DIRECCIÓN / ADMINISTRACIÓN GENERAL**, en representación de la firma comercial y operativa del establecimiento gastronómico, en lo sucesivo denominada **"EL CLIENTE"**.

Y de la otra parte:
**EL EQUIPO DE INGENIERÍA Y SISTEMAS**, en su condición de desarrolladores e implementadores del software de gestión y arquitectura de hardware, en lo sucesivo denominado **"EL PROVEEDOR"**.

Ambas partes convienen en suscribir la presente **ACTA OFICIAL DE ENTREGA, CERTIFICACIÓN Y ACEPTACIÓN DEFINITIVA**, bajo los términos siguientes:

---

### CLÁUSULA PRIMERA: OBJETO Y ALCANCE ENTREGADO

Mediante el presente documento, **EL PROVEEDOR** hace entrega formal, definitiva e instalada en hardware operativo del sistema integral denominado **TOCINETA POS (Versión 3.0)**, con arquitectura local autónoma (LAN), motor de base de datos relacional SQLite con diario Write-Ahead Logging (`WAL`), sincronización offline y soporte para impresión térmica ESC/POS de 58 mm.

El sistema comprende los módulos integrados y auditados a lo largo de las 7 fases de desarrollo:
1. **Fase 1 (Core POS y Caja):** Facturación multimétodo (Efectivo $, Pago Móvil, Punto Débito), cálculo de vueltos, tasa BCV inmutable y arqueo de caja con Cierre Z criptográfico.
2. **Fase 2 (Cocina y Comandas KDS):** Monitor interactivo con semáforo de tiempos de preparación, enrutamiento térmico de comandas y gestión de estaciones (Plancha y Despacho).
3. **Fase 3 (Inventario y Recetas):** Descuento automático de ingredientes por receta, control de mermas, alertas de stock mínimo y valorización de inventario.
4. **Fase 4 (Mesas y Salón):** Mapa interactivo de mesas, apertura, unión, separación de cuentas y comandero móvil para meseros.
5. **Fase 5 (Reportería y Auditoría):** Cadena de bloques inmutable de auditoría (SHA-256), reportes de ventas, rentabilidad Kasavana & Smith y respaldos físicos automáticos a bóveda USB.
6. **Fase 6 (Personal y Nómina):** Control de usuarios individuales, roles con permisos granulares (cobro, edición de carta, visualización de costos), trazabilidad de acciones, anticipos, cuentas de empleado con cena del local y recibos de liquidación térmica.
7. **Fase 7 (Cotizador, Socios, Menú QR, Multi-Negocio y Endurecimiento):** Cotizador de eventos conectado a recetas reales con simulador privado de utilidad, PDF/WhatsApp para clientes y conversión a reserva con lista consolidada de compras; gestión de socios con aportes, retiros y reparto porcentual de dividendos; menú digital QR en tiempo real con filtro de agotados; configuración multi-restaurante centralizada con asistente inicial; y endurecimiento con simulacro de restauración de respaldo verificado.

---

### CLÁUSULA SEGUNDA: CERTIFICACIÓN DE PRUEBAS Y ENDURECIMIENTO

Las partes dejan formal constancia de que se han ejecutado satisfactoriamente las siguientes pruebas de endurecimiento y calidad:

1. **Simulacro de Restauración de Respaldo:**
   - Se ejecutó el motor de restauración de desastres (`scripts/restore-cli.ts`) sobre una copia de seguridad encriptada.
   - Resultado: Integridad SQLite 100% verificada (`integrity_check = ok`), cadena de bloques de auditoría íntegra y restauración completa en menos de 5 segundos.
2. **Prueba de Apagón y Corte Súbito:**
   - Simulación de interrupción eléctrica durante el registro de comanda y cobro.
   - Resultado: La base de datos WAL no presentó corrupción de datos ni órdenes huérfanas. Se validó la contingencia operativa con talonarios de papel numerados y transcripción diferida posterior.
3. **Prueba de Concurrencia y Carga:**
   - 5 dispositivos conectados simultáneamente (Caja, Mesero 1, Mesero 2, Pantalla KDS Cocina y Menú QR Cliente).
   - Resultado: Cero condiciones de carrera, tiempos de respuesta menores a 50 ms en red local y despacho fluido de tickets.
4. **Rotación de Claves Semilla y Seguridad RBAC:**
   - Obligatoriedad de cambio de contraseña en usuarios semilla.
   - Verificación de ocultamiento estricto de costos y márgenes de ganancia para personal no autorizado.
5. **Cumplimiento de Estándares de Diseño y Código:**
   - Validador `pnpm run guard`: 100% Aprobado.
   - Verificador de tipos `pnpm -r run lint`: 100% Aprobado (0 errores).
   - Compilación productiva `pnpm -r run build`: 100% Aprobada.

---

### CLÁUSULA TERCERA: DOCUMENTACIÓN Y MANUALES OPERATIVOS

Se hace entrega de los manuales operativos de 1 página integrados directamente en la aplicación web (botón de ayuda en Configuración) y en archivos Markdown:
- Manual de Administradora (`docs/manual-administradora.md`)
- Manual de Cajera (`docs/manual-cajera.md`)
- Manual de Mesonero, Plancha y Despacho (`docs/manual-mesonero-cocina.md`)

---

### CLÁUSULA CUARTA: CONFORMIDAD Y ACEPTACIÓN

**EL CLIENTE** manifiesta su total conformidad y satisfacción con el software entregado, la estabilidad operativa del hardware y la capacitación impartida, declarando recibido a plena satisfacción el sistema **TOCINETA POS**.

En señal de conformidad y para que surta todos los efectos legales y comerciales pertinentes, se firma la presente acta en dos (2) ejemplares de un mismo tenor y a un solo efecto.

_______________________________________                 _______________________________________
      POR "EL CLIENTE"                                        POR "EL PROVEEDOR"
  DIRECCIÓN Y ADMINISTRACIÓN GENERAL                      EQUIPO DE INGENIERÍA Y SISTEMAS
          SISTEMA TOCINETA                                     SISTEMA TOCINETA
