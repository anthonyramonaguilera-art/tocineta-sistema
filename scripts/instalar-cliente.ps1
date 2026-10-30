# Uso: powershell -ExecutionPolicy Bypass -File instalar-cliente.ps1 -Zip "C:\Users\...\Downloads\tocineta-XXXX.zip"
param([Parameter(Mandatory=$true)][string]$Zip)
$ErrorActionPreference = "Stop"
$dest = "C:\Tocineta"
$stamp = Get-Date -Format "yyyyMMdd-HHmm"

# Respaldo de la base de datos y del .env actuales antes de tocar nada
if (Test-Path "$dest\apps\server\data") {
  $bk = "C:\Tocineta-respaldos\$stamp"
  New-Item $bk -ItemType Directory -Force | Out-Null
  Copy-Item "$dest\apps\server\data" "$bk\data" -Recurse -Force
  if (Test-Path "$dest\.env") { Copy-Item "$dest\.env" "$bk\.env" -Force }
  Write-Host "Respaldo en $bk" -ForegroundColor Yellow
}

# Descomprime encima SIN borrar data ni .env
$tmp = Join-Path $env:TEMP "tocineta-upd"
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive $Zip -DestinationPath $tmp -Force
New-Item $dest -ItemType Directory -Force | Out-Null
robocopy $tmp $dest /E /NFL /NDL /NJH /NJS /XD data /XF .env | Out-Null
Remove-Item $tmp -Recurse -Force

Set-Location $dest
if (-not (Test-Path ".env") -and (Test-Path ".env.example")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Se creó .env desde .env.example: REVÍSALO (puerto, claves)." -ForegroundColor Yellow
}

# --force es CLAVE para arreglar el error de @tocineta/shared en PC nuevas
pnpm install --frozen-lockfile --force
pnpm run build
pnpm run db:migrate

Write-Host "Instalado. Para iniciar: pnpm start (en $dest)" -ForegroundColor Green