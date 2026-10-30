# Uso: powershell -ExecutionPolicy Bypass -File scripts\empaquetar.ps1
$ErrorActionPreference = "Stop"
$root = (Get-Location).Path
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$stage = Join-Path $env:TEMP "tocineta-stage"
$zip = Join-Path $root "tocineta-$stamp.zip"

Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item $stage -ItemType Directory | Out-Null

# Copia el proyecto SIN node_modules, bases de datos, secretos ni dist
# CORREGIDO: Quitamos 'backups' de la lista de exclusión para que el código fuente viaje en el ZIP
robocopy $root $stage /E /NFL /NDL /NJH /NJS `
  /XD node_modules .git .pnpm-store dist data logs playwright-report test-results `
  /XF *.db *.db-wal *.db-shm *.db-journal *.age *.log .env *.zip | Out-Null

if (Test-Path "$root\.env.example") { Copy-Item "$root\.env.example" "$stage\.env.example" -Force }

if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path "$stage\*" -DestinationPath $zip -CompressionLevel Optimal
Remove-Item $stage -Recurse -Force

Write-Host "Listo: $zip" -ForegroundColor Green
Write-Host ("Tamaño: {0:N1} MB" -f ((Get-Item $zip).Length / 1MB))