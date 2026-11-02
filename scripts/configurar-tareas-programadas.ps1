<#
.SYNOPSIS
    Configurador automatizado de Tareas Programadas de Windows para el Sistema TOCINETA.
.DESCRIPTION
    Registra y configura las tareas programadas oficiales en el Programador de Tareas de Windows (Task Scheduler):
      1. Tocineta-Respaldo-Drive:
         - Horario: Diario a las 05:00 AM
         - Accion: Ejecuta scripts/respaldo-drive.ps1 para generar snapshot seguro en caliente,
                   cifrar con Age y sincronizar a USB y Google Drive.
      2. Tocineta-Alertas-Telegram:
         - Horario: Diario a las 08:00 AM
         - Accion: Ejecuta scripts/alertas-telegram.ps1 para validar salud del servidor y notificar por Telegram.
.PARAMETER Action
    Accion a ejecutar: Install (predeterminada), Uninstall, Status.
.PARAMETER BackupTime
    Hora programada para el respaldo (por defecto "05:00").
.PARAMETER AlertTime
    Hora programada para la alerta de salud (por defecto "08:00").
#>

[CmdletBinding()]
param (
    [ValidateSet("Install", "Uninstall", "Status")]
    [string]$Action = "Install",

    [string]$BackupTime = "05:00",
    [string]$AlertTime = "08:00"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$powershellExe = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
if (-not $powershellExe) {
    $powershellExe = "powershell.exe"
}

$taskBackupName = "Tocineta-Respaldo-Drive"
$taskAlertName = "Tocineta-Alertas-Telegram"

$backupScript = Join-Path $repoRoot "scripts\respaldo-drive.ps1"
$alertScript = Join-Path $repoRoot "scripts\alertas-telegram.ps1"

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "     SISTEMA TOCINETA - TAREAS PROGRAMADAS DE WINDOWS           " -ForegroundColor Yellow
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "Accion seleccionada: $Action" -ForegroundColor Gray

# Verificar privilegios de Administrador
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[ADVERTENCIA] Se recomienda ejecutar PowerShell como Administrador para registrar tareas a nivel del sistema." -ForegroundColor Yellow
}

function Get-TaskInfo {
    param([string]$TaskName)
    try {
        return Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    } catch {
        return $null
    }
}

if ($Action -eq "Status") {
    Write-Host "`nConsultando estado actual de las tareas programadas:" -ForegroundColor Cyan
    
    $t1 = Get-TaskInfo -TaskName $taskBackupName
    if ($t1) {
        Write-Host "  -> $taskBackupName : [REGISTRADA] Estado: $($t1.State)" -ForegroundColor Green
    } else {
        Write-Host "  -> $taskBackupName : [NO ENCONTRADA]" -ForegroundColor DarkGray
    }

    $t2 = Get-TaskInfo -TaskName $taskAlertName
    if ($t2) {
        Write-Host "  -> $taskAlertName : [REGISTRADA] Estado: $($t2.State)" -ForegroundColor Green
    } else {
        Write-Host "  -> $taskAlertName : [NO ENCONTRADA]" -ForegroundColor DarkGray
    }

    Write-Host ""
    exit 0
}

if ($Action -eq "Uninstall") {
    Write-Host "`nDesinstalando tareas programadas..." -ForegroundColor Yellow

    if (Get-TaskInfo -TaskName $taskBackupName) {
        Unregister-ScheduledTask -TaskName $taskBackupName -Confirm:$false
        Write-Host "✓ Tarea '$taskBackupName' eliminada exitosamente." -ForegroundColor Green
    } else {
        Write-Host "  Tarea '$taskBackupName' no estaba registrada." -ForegroundColor Gray
    }

    if (Get-TaskInfo -TaskName $taskAlertName) {
        Unregister-ScheduledTask -TaskName $taskAlertName -Confirm:$false
        Write-Host "✓ Tarea '$taskAlertName' eliminada exitosamente." -ForegroundColor Green
    } else {
        Write-Host "  Tarea '$taskAlertName' no estaba registrada." -ForegroundColor Gray
    }

    Write-Host "`nDesinstalacion completada." -ForegroundColor Green
    exit 0
}

if ($Action -eq "Install") {
    Write-Host "`nConfigurando Tareas Programadas de Produccion:" -ForegroundColor Cyan

    # 1. Registrar Tarea de Respaldo Cifrado hacia Drive (05:00 AM)
    Write-Host "1. Creando tarea '$taskBackupName' ($BackupTime diario)..." -ForegroundColor DarkCyan
    $actionBackup = New-ScheduledTaskAction -Execute $powershellExe -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$backupScript`"" -WorkingDirectory $repoRoot
    $triggerBackup = New-ScheduledTaskTrigger -Daily -At $BackupTime
    $settingsBackup = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest

    try {
        Register-ScheduledTask -TaskName $taskBackupName -Action $actionBackup -Trigger $triggerBackup -Settings $settingsBackup -Principal $principal -Description "Respaldo diario cifrado con Age hacia almacenamiento USB y Google Drive para el ERP TOCINETA." -Force | Out-Null
        Write-Host "  [OK] '$taskBackupName' registrada exitosamente a las $BackupTime." -ForegroundColor Green
    } catch {
        Write-Host "  [AVISO] No se pudo registrar via Register-ScheduledTask, intentando via schtasks.exe: $($_.Exception.Message)" -ForegroundColor Yellow
        $schCmd = "schtasks.exe /create /tn `"$taskBackupName`" /tr `"$powershellExe -ExecutionPolicy Bypass -WindowStyle Hidden -File \`"$backupScript\`"`" /sc daily /st $BackupTime /f"
        Invoke-Expression $schCmd
    }

    # 2. Registrar Tarea de Alertas por Telegram (08:00 AM)
    Write-Host "2. Creando tarea '$taskAlertName' ($AlertTime diario)..." -ForegroundColor DarkCyan
    $actionAlert = New-ScheduledTaskAction -Execute $powershellExe -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$alertScript`"" -WorkingDirectory $repoRoot
    $triggerAlert = New-ScheduledTaskTrigger -Daily -At $AlertTime
    $settingsAlert = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

    try {
        Register-ScheduledTask -TaskName $taskAlertName -Action $actionAlert -Trigger $triggerAlert -Settings $settingsAlert -Principal $principal -Description "Verificacion diaria de salud del sistema TOCINETA y notificaciones remotas via Telegram." -Force | Out-Null
        Write-Host "  [OK] '$taskAlertName' registrada exitosamente a las $AlertTime." -ForegroundColor Green
    } catch {
        Write-Host "  [AVISO] No se pudo registrar via Register-ScheduledTask, intentando via schtasks.exe: $($_.Exception.Message)" -ForegroundColor Yellow
        $schCmd = "schtasks.exe /create /tn `"$taskAlertName`" /tr `"$powershellExe -ExecutionPolicy Bypass -WindowStyle Hidden -File \`"$alertScript\`"`" /sc daily /st $AlertTime /f"
        Invoke-Expression $schCmd
    }

    Write-Host ""
    Write-Host "=================================================================" -ForegroundColor Green
    Write-Host "   TAREAS PROGRAMADAS CONFIGURADAS EXITOSAMENTE                 " -ForegroundColor Green
    Write-Host "=================================================================" -ForegroundColor Green
    Write-Host "- Respaldo Cifrado a Drive: $BackupTime (Diario)" -ForegroundColor Gray
    Write-Host "- Alertas de Salud Telegram: $AlertTime (Diario)" -ForegroundColor Gray
    Write-Host "Para verificar su ejecucion o administrarlas, abra 'taskschd.msc' en Windows." -ForegroundColor DarkGray
    Write-Host ""
}
