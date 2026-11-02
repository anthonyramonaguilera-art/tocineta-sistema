# ==============================================================================
# SCRIPT DE EMPAQUETADO PARA EL DIRECTOR - TOCINETA ERP
# ==============================================================================
$ErrorActionPreference = "Stop"
$timestamp = Get-Date -Format "yyyyMMdd-HHmm"
$zipName = "TOCINETA-ENTREGA-DIRECTOR-$timestamp.zip"
$tempDir = Join-Path $env:TEMP "tocineta_empaquetado_$timestamp"

Write-Host "1. Preparando carpeta temporal..." -ForegroundColor Cyan
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

# ==============================================================================
# 2. GENERANDO EL INFORME PARA EL DIRECTOR
# ==============================================================================
$informe = @"
# INFORME EJECUTIVO DE AVANCES Y ESTADO DEL SISTEMA - TOCINETA ERP
**Fecha:** $(Get-Date -Format "dd/MM/yyyy HH:mm")
**Rama:** r2/go-live

## 1. Resumen de Avances (Lo que ya está listo)
El sistema ha superado la fase de "Blindaje de Seguridad y Estabilidad Financiera". 
- **Seguridad (Oleadas 1-3):** Backend blindado contra suplantación (x-user-id), PINs con bloqueo por fuerza bruta, logs limpios y Outbox offline (no se pierden ventas sin internet).
- **Finanzas y Cobros (Ola A):** El sistema ahora respeta la moneda nativa (Pago Móvil=Bs, Zelle=USD). Se separaron Punto de Venta y UBI. Los cobros coinciden al 100% (0 centavos de diferencia) entre el ticket, la caja y los reportes.
- **Operación y UX (Ola B):** El Cierre Z ya no entra en bucle, permite descargar PDF/Excel y la cajera puede cerrar su turno. Se corrigió el error de React (#310) en el menú. Se agregaron los 6 sabores de **Malteadas** (Brownie, Flips, Nucita, Ovomaltina, Samba, Oreo) y botones de visibilidad en la Carta.

## 2. Hallazgos Recientes y Correcciones Aplicadas
- **Error 400 al cobrar:** Resuelto. El frontend enviaba un campo de referencia nulo que el backend rechazaba.
- **Arqueo Ciego Incompleto:** Resuelto. Ahora el cierre pide contar los montos físicos/bancarios por cada método (Pago Móvil, Punto, UBI, etc.) y calcula la diferencia contra lo que espera el sistema.
- **Finanzas Vacías:** Resuelto. La pestaña de "Ventas por método de pago" ahora se alimenta de los pagos reales de la jornada.

## 3. Deudas Técnicas (Fase C - Embellecimiento y Excelencia)
Lo que queda pendiente NO bloquea el cobro ni la operación, pero es necesario para la excelencia:
- **Diseño Visual (First Mobile):** Pulir animaciones, mover el botón "Cobrar" en el POS, mejorar el contraste.
- **Impresión ESC/POS Nativa:** Eliminar la dependencia de scripts de PowerShell y enviar bytes directos al Spooler.
- **Módulo de Reembolsos:** Auditar que las devoluciones vayan exactas al bucket original (Bs, USD, Zelle).
- **Multi-Sede:** Blindar transferencias de inventario entre Alta Vista y Los Olivos.

## 4. Preguntas para el Director (Para generar el Plan de Instalación)
Para poder empaquetar la versión final (Instalador `.exe`), necesitamos definir:
1. **Ruta de Instalación:** ¿En qué carpeta del disco (ej. `C:\Tocineta\`) se instalará en la PC del restaurante?
2. **Red Local:** ¿La PC servidor tendrá una IP fija (ej. `192.168.1.50`)? Las tablets de meseros y cocina necesitan saber esa IP para conectarse.
3. **Wi-Fi (AP Isolation):** ¿El router del restaurante permite que las tablets vean a la PC servidor? (A veces los routers aíslan los dispositivos).
4. **Impresoras:** ¿Se usarán 1 o 2 impresoras térmicas? ¿Cuáles son sus nombres exactos en Windows?
"@

$informePath = Join-Path $tempDir "INFORME-DIRECTOR.md"
$informe | Out-File -FilePath $informePath -Encoding UTF8

# ==============================================================================
# 3. COPIANDO EL CÓDIGO FUENTE (Excluyendo basura)
# ==============================================================================
Write-Host "2. Copiando código fuente limpio..." -ForegroundColor Cyan
$itemsToInclude = @(
    "apps/server/src", "apps/server/test", "apps/server/package.json", "apps/server/tsconfig.json",
    "apps/web/src", "apps/web/package.json", "apps/web/tsconfig.json", "apps/web/vite.config.ts",
    "packages/shared/src", "packages/shared/test", "packages/shared/package.json",
    "scripts", "docs", "package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "tsconfig.json",
    "GEMINI.md", "AGENTS.md", "README.md", "BITACORA-DE-CONTEXTO.md"
)

foreach ($item in $itemsToInclude) {
    $source = Join-Path $PWD.Path $item
    $dest = Join-Path $tempDir $item
    if (Test-Path $source) {
        $destParent = Split-Path -Parent $dest
        if ($destParent) { New-Item -ItemType Directory -Path $destParent -Force | Out-Null }
        Copy-Item -Path $source -Destination $dest -Recurse -Force
    }
}

# ==============================================================================
# 4. LIMPIEZA PROFUNDA
# ==============================================================================
Write-Host "3. Limpiando node_modules, dist y archivos .db..." -ForegroundColor Cyan
$excludeDirs = @("node_modules", "dist", "build", ".vite", "coverage", ".git")
$excludeFiles = @("*.log", "*.db", "*.db-shm", "*.db-wal", "*.zip", ".env")

Get-ChildItem -Path $tempDir -Recurse -Force -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -in $excludeDirs } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

Get-ChildItem -Path $tempDir -Recurse -Force -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "*.log" -or $_.Name -like "*.db" -or $_.Name -like "*.zip" -or $_.Name -eq ".env" } |
    Remove-Item -Force -ErrorAction SilentlyContinue

# ==============================================================================
# 5. COMPRIMIR
# ==============================================================================
Write-Host "4. Comprimiendo..." -ForegroundColor Cyan
$zipPath = Join-Path $PWD.Path $zipName
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -CompressionLevel Optimal

# Limpieza final
Remove-Item -Path $tempDir -Recurse -Force

$sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host "============================================================" -ForegroundColor Green
Write-Host "PROCESO COMPLETADO" -ForegroundColor Green
Write-Host "ZIP generado: $zipPath" -ForegroundColor Green
Write-Host "Tamaño: $sizeMB MB" -ForegroundColor Green
Write-Host "Incluye: Código fuente + INFORME-DIRECTOR.md" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green