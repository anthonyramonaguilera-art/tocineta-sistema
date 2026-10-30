# Exigir Administrador
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "ERROR: Este script debe ejecutarse como Administrador. Abra PowerShell como Administrador y vuelva a intentarlo."
    exit 1
}

$taskName = "TocinetaSpoolerWatch"
$scriptPath = "$PSScriptRoot\spooler-watch.ps1"

if (-not (Test-Path $scriptPath)) {
    Write-Error "No se encuentra spooler-watch.ps1 en $PSScriptRoot"
    exit 1
}

# Crear trigger al inicio del sistema
$trigger = New-ScheduledTaskTrigger -AtStartup
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "NT AUTHORITY\SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Trigger $trigger -Action $action -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "Tarea programada '$taskName' instalada exitosamente con privilegios SYSTEM y RunLevel Highest."
