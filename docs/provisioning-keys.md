# PROTOCOLO DE APROVISIONAMIENTO SEGURO DE CLAVES CRIPTOGRÁFICAS (age)
**Sistema:** Sistema Operativo Local Tocineta Sonríe  
**Sub-Hito:** M10.1 (Hallazgo F7 y Robustez C.3)  
**Hardware:** Impresora Térmica 58mm `DP58U-03` / Driver `POS-58`  

---

## 1. PRINCIPIO DE SEGURIDAD ABSOLUTA (ZERO LEAKAGE)

La laptop del Food Truck opera en un entorno físico de alto riesgo (posibilidad de robo, pérdida, caídas eléctricas o inspecciones). Por diseño:
- **La laptop JAMÁS almacena en disco ni en base de datos la clave privada maestra (`AGE-SECRET-KEY-1...`).**
- La laptop solo conoce y almacena las claves públicas (`age1...`).
- La única copia autorizada de la clave privada de la Sra. Olinelcys existe en formato físico (ticket térmico) guardado en un sobre sellado bajo custodia personal de la dueña.

---

## 2. PROCEDIMIENTO DE EJECUCIÓN (CLI AISLADO)

Con la impresora `DP58U-03` conectada y encendida, ejecutar en una terminal de PowerShell:

```powershell
pnpm tsx scripts/provision-production-keys.ts --printer "DP58U-03"
```

### Acciones que ejecuta el script automáticamente:
1. **Configura el spooler:** Aplica `Set-Printer -Name "DP58U-03" -KeepPrintedJobs $false` para evitar que Windows guarde copias de los trabajos RAW en disco.
2. **Generación efímera en RAM:** Genera el par de claves X25519 con `age-encryption` en la memoria del proceso Node.js.
3. **Impresión RAW sin spool:** Renderiza el ticket ESC/POS (WPC1252, sin cutter, sin buzzer) y lo despacha directamente a `winspool.Drv` mediante `tools/g0-probe/raw-spooler.ps1`.
4. **Higiene de memoria obligatoria (`finally`):**
   - Ejecuta `buffer.fill(0)` sobre todos los buffers que contuvieron la clave privada en RAM.
   - Limpia cualquier archivo temporal en `%SystemRoot%\System32\spool\PRINTERS`.
   - Verifica que la cola de impresión reporte 0 trabajos pendientes.
5. **Persistencia exclusiva de clave pública:**
   - Escribe la clave pública `age1...` en `.env` (`AGE_RECIPIENT_OLINELCYS=...`).
   - Registra la clave pública en `_system_meta` de la base de datos SQLite.

---

## 3. CHECKLIST DE VERIFICACIÓN MANUAL OBLIGATORIA (C.3)

Al finalizar la ejecución, el operador debe confirmar los 3 puntos antes de cerrar la sesión:

```plaintext
VERIFICACIÓN MANUAL REQUERIDA:
1. Confirmar ticket físico con AGE-SECRET-KEY-1... legible y sin caracteres corruptos.
2. Confirmar Get-ChildItem $env:SystemRoot\System32\spool\PRINTERS retorna 0 archivos.
3. Confirmar que .env y business_settings tienen la nueva clave pública age1...
NO hacer nada más hasta confirmar los 3 puntos.
```

Una vez verificado el ticket impreso, guárdelo inmediatamente en el sobre sellado correspondiente.
