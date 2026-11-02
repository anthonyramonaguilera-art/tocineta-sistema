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
Write-Host "2. Generando INFORME-DIRECTOR.md procesado..." -ForegroundColor Cyan
$fechaActual = Get-Date -Format "dd/MM/yyyy HH:mm"
$currentBranch = "r2/go-live"
try {
    $branchOutput = (git branch --show-current 2>$null)
    if ($branchOutput) { $currentBranch = $branchOutput.Trim() }
} catch {}

$templatePath = Join-Path $PWD.Path "INFORME-DIRECTOR.md"
if (-not (Test-Path $templatePath)) {
    throw "No se encontró la plantilla INFORME-DIRECTOR.md en la raíz del repositorio."
}

$contenido = [System.IO.File]::ReadAllText($templatePath, [System.Text.Encoding]::UTF8)
$contenido = $contenido.Replace("{{FECHA}}", $fechaActual).Replace("{{RAMA}}", $currentBranch)

$informePath = Join-Path $tempDir "INFORME-DIRECTOR.md"
$utf8WithBom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($informePath, $contenido, $utf8WithBom)

# ==============================================================================
# 3. COPIANDO EL CÓDIGO FUENTE (Excluyendo basura)
# ==============================================================================
Write-Host "3. Copiando código fuente limpio..." -ForegroundColor Cyan
$itemsToInclude = @(
    "apps/server/src", "apps/server/test", "apps/server/package.json", "apps/server/tsconfig.json",
    "apps/web/src", "apps/web/package.json", "apps/web/tsconfig.json", "apps/web/vite.config.ts",
    "packages/shared/src", "packages/shared/test", "packages/shared/package.json",
    "scripts", "docs", "package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "tsconfig.json",
    "GEMINI.md", "AGENTS.md", "README.md", "BITACORA-DE-CONTEXTO.md", ".env.example"
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
Write-Host "4. Limpiando node_modules, dist y archivos .db..." -ForegroundColor Cyan
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
Write-Host "5. Comprimiendo..." -ForegroundColor Cyan
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
