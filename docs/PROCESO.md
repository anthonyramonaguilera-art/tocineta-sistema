# DEFINITION OF DONE Y REGLAS DE PROCESO — SISTEMA TOCINETA

Este documento establece de manera obligatoria y vinculante el **Definition of Done (DoD)** y la estructura estricta para la entrega de informes en cada fase de desarrollo, auditoría y reconstrucción del sistema TOCINETA.

---

## 1. DEFINITION OF DONE (DoD)

Para que cualquier fase, historia o módulo se considere **COMPLETADO (DONE)**, debe cumplir obligatoriamente y sin excepción con los siguientes criterios:

1. **Compilación Limpia:**
   - `pnpm -r run build` debe compilar al 100% sin advertencias críticas ni errores en todos los paquetes del monorepo (`packages/shared`, `apps/server`, `apps/web`).

2. **Cero Errores de Tipado y Lint:**
   - `pnpm -r run lint` (que ejecuta chequeos de tipos TypeScript `tsc --noEmit`) debe retornar código de salida `0` con cero advertencias y cero errores.

3. **Cero Fallos en Suite de Pruebas Automatizadas:**
   - `pnpm -r run test` debe ejecutarse con 0 fallos (0 failures).
   - **Regla Estricta:** Queda terminantemente PROHIBIDO borrar pruebas existentes o debilitar aserciones (asserts) para forzar un pase.
   - Cualquier prueba omitida (`skip`) debe contener un comentario explícito que justifique el motivo técnico exacto.

4. **Guardias de Integridad y Gobernanza (AGENTS.md & PRD v2.0):**
   - **Cero referencias a nombres propios o marcas externas prohibidas:** Prohibido en código fuente, esquemas, migraciones o UI el uso de nombres o marcas externas (`Olinelcys`, `Anthony`, `Carlos`, `Andrea`, `Miguel`, `José`, `Valery`, `Treinta`, `Sonríe`, `God Mode`, `Modo Dios`, `Varons`).
   - Marca corporativa única: **"TOCINETA"**.
   - Perfiles canónicos: `ADMIN`, `CAJERA`, `MESERO`, `PLANCHA`, `DESPACHO`.
   - SQLite en modo WAL, `foreign_keys = ON`, `busy_timeout = 5000`.

5. **Diseño Mobile-First y Contraste Semántico:**
   - La aplicación debe iniciar por defecto en **Modo Claro (`light`)**.
   - Garantía de contraste semántico estricto (prohibido texto blanco sobre fondos claros o cajas oscuras sin adaptación de tema).
   - Botones táctiles de al menos 48px de alto (`min-h-[48px]`).

6. **Evidencia Visual Responsiva y de Accesibilidad:**
   - Generación de capturas de pantalla de todas las pantallas/vistas montadas en dos resoluciones canónicas:
     * **390x844** (Smartphone / móvil táctil)
     * **768x1024** (Tablet / punto de venta)
   - Ambas resoluciones deben capturarse tanto en **Modo Claro** como en **Modo Oscuro**.

7. **Matriz de Trazabilidad Completa:**
   - Registro de cada elemento interactivo, formulario y botón hacia su handler de React, endpoint de API backend, tabla y columna de base de datos, y estado funcional (`OK`, `ROTO`, `ADORNO`, `DEMO`).

8. **Congelamiento y Etiquetado Git:**
   - Creación de un tag Git canónico por fase (ej. `pre-reconstruccion`, `fase-0`, `fase-1`, etc.) en la rama activa.

---

## 2. FORMATO FIJO DE INFORME DE FASE

Cada entrega de fase debe generar un informe formal en `docs/informes/INFORME-FASE-<X>.md` respetando obligatoriamente la siguiente plantilla:

```markdown
# INFORME DE FASE <NÚMERO>: <NOMBRE DE LA FASE>
**Fecha:** YYYY-MM-DD
**Rama Git:** <nombre-de-rama>
**Commit SHA:** <hash-del-commit>
**Tag Git:** <tag-creado>

---

## 1. RESUMEN EJECUTIVO
Breve síntesis de los objetivos alcanzados, estado general del sistema y cumplimiento del DoD.

---

## 2. VALIDACIÓN TÉCNICA Y SALIDA REAL DE COMANDOS

### 2.1. Chequeo de Tipos y Lint (`pnpm -r run lint`)
- Comando ejecutado: `pnpm -r run lint`
- Código de salida: `0`
- Salida real del comando:
\`\`\`text
<pegar salida literal sin recortar>
\`\`\`

### 2.2. Compilación de Producción (`pnpm -r run build`)
- Comando ejecutado: `pnpm -r run build`
- Código de salida: `0`
- Salida real del comando:
\`\`\`text
<pegar salida literal sin recortar>
\`\`\`

### 2.3. Suite de Pruebas Automatizadas (`pnpm -r run test`)
- Comando ejecutado: `pnpm -r run test`
- Código de salida: `0`
- Resumen: X pruebas pasadas, 0 fallidas, Y omitidas justificadas.
- Salida real del comando:
\`\`\`text
<pegar salida literal del resumen de vitest>
\`\`\`

### 2.4. Guardias de Integridad y Reglas Estrictas
- Chequeo de nombres y marcas prohibidas: PASÓ (0 coincidencias)
- Chequeo de pragmas SQLite y backup de seguridad: VERIFICADO

---

## 3. MATRIZ DE COMPONENTES Y VISTAS AUDITADAS
Referencia o enlace al documento de matriz (`docs/auditoria/MATRIZ.md`):
- Total de pantallas auditadas: N
- Total de elementos interactivos: N
- Elementos OK: N | ROTO: N | ADORNO: N | DEMO: N

---

## 4. EVIDENCIA VISUAL (CAPTURAS RESPONSIVAS)
Ubicación de capturas: `docs/auditoria/capturas/`
- Matriz de capturas (390x844 y 768x1024 en Modo Claro y Modo Oscuro).
- Verificación visual de legibilidad, contraste y layout táctil.

---

## 5. CAMBIOS IMPLEMENTADOS (QUÉ SE HIZO)
Detalle técnico preciso de los archivos modificados, bugs corregidos y refactorizaciones realizadas.

---

## 6. LÍMITES Y EXCLUSIONES (QUÉ NO SE HIZO)
Lista explícita de lo que intencionalmente se pospuso, no se tocó o quedó fuera del alcance de la fase para preservar la estabilidad.

---

## 7. RIESGOS DETECTADOS Y DEUDA TÉCNICA
Hallazgos críticos, vulnerabilidades, deuda de UI (ej. `!important`, `text-white`), endpoints huérfanos o datos demo identificados.

---

## 8. REGISTRO GIT
- Tag de congelamiento creado y verificado.
```
