<#
.SYNOPSIS
    Configurador automatizado de Tareas Programadas de Windows para el Sistema TOCINETA.
.DESCRIPTION
    Registra y configura las tareas programadas oficiales en el Programador de Tareas de Windows (Task Scheduler):
      1. Tocineta-Actualizador-Automatico:
         - Horario: Diario a las 05:00 AM
         - Accion: Ejecuta scripts/actualizar.ps1 para buscar releases en GitHub, validar hash SHA-256,
                   respaldar SQLite, actualizar, migrar y verificar salud con rollback automatico.
      2. Tocineta-Respaldo-Drive:
         - Horario: Diario a las 05:30 AM
         - Accion: Ejecuta scripts/respaldo-drive.ps1 para generar snapshot seguro en caliente,
                   cifrar con Age y sincronizar a USB y Google Drive.
      3. Tocineta-Alertas-Telegram:
         - Horario: Diario a las 08:00 AM
         - Accion: Ejecuta scripts/alertas-telegram.ps1 para validar salud del servidor y notificar por Telegram.
.PARAMETER Action
    Accion a ejecutar: Install (predeterminada), Uninstall, Status.
.PARAMETER UpdateTime
    Hora programada para el actualizador automatico (por defecto "05:00").
.PARAMETER BackupTime
    Hora programada para el respaldo (por defecto "05:30").
.PARAMETER AlertTime
    Hora programada para la alerta de salud (por defecto "08:00").
#>

[CmdletBinding()]
param (
    [ValidateSet("Install", "Uninstall", "Status")]
    [string]$Action = "Install",

    [string]$UpdateTime = "05:00",
    [string]$BackupTime = "05:30",
    [string]$AlertTime = "08:00",
    [string]$AlertEveningTime = "20:00"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$powershellExe = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
if (-not $powershellExe) {
    $powershellExe = "powershell.exe"
}

$taskUpdateName = "Tocineta-Actualizador-Automatico"
$taskBackupName = "Tocineta-Respaldo-Drive"
$taskAlertName = "Tocineta-Alertas-Telegram"
$taskTelegramName = "Tocineta-Actualizador-Telegram"

$updateScript = Join-Path $repoRoot "scripts\actualizar.ps1"
$backupScript = Join-Path $repoRoot "scripts\respaldo-drive.ps1"
$alertScript = Join-Path $repoRoot "scripts\alertas-telegram.ps1"
$telegramScript = Join-Path $repoRoot "scripts\actualizar-telegram.ps1"

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
    Write-Host ""
    Write-Host "Consultando estado actual de las tareas programadas:" -ForegroundColor Cyan
    
    $t0 = Get-TaskInfo -TaskName $taskUpdateName
    if ($t0) {
        Write-Host "  -> $taskUpdateName : [REGISTRADA] Estado: $($t0.State)" -ForegroundColor Green
    } else {
        Write-Host "  -> $taskUpdateName : [NO ENCONTRADA]" -ForegroundColor DarkGray
    }

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

    $t3 = Get-TaskInfo -TaskName $taskTelegramName
    if ($t3) {
        Write-Host "  -> $taskTelegramName : [REGISTRADA] Estado: $($t3.State)" -ForegroundColor Green
    } else {
        Write-Host "  -> $taskTelegramName : [NO ENCONTRADA]" -ForegroundColor DarkGray
    }

    Write-Host ""
    exit 0
}

if ($Action -eq "Uninstall") {
    Write-Host ""
    Write-Host "Desinstalando tareas programadas..." -ForegroundColor Yellow

    if (Get-TaskInfo -TaskName $taskUpdateName) {
        Unregister-ScheduledTask -TaskName $taskUpdateName -Confirm:$false
        Write-Host "[OK] Tarea '$taskUpdateName' eliminada exitosamente." -ForegroundColor Green
    } else {
        Write-Host "  Tarea '$taskUpdateName' no estaba registrada." -ForegroundColor Gray
    }

    if (Get-TaskInfo -TaskName $taskBackupName) {
        Unregister-ScheduledTask -TaskName $taskBackupName -Confirm:$false
        Write-Host "[OK] Tarea '$taskBackupName' eliminada exitosamente." -ForegroundColor Green
    } else {
        Write-Host "  Tarea '$taskBackupName' no estaba registrada." -ForegroundColor Gray
    }

    if (Get-TaskInfo -TaskName $taskAlertName) {
        Unregister-ScheduledTask -TaskName $taskAlertName -Confirm:$false
        Write-Host "[OK] Tarea '$taskAlertName' eliminada exitosamente." -ForegroundColor Green
    } else {
        Write-Host "  Tarea '$taskAlertName' no estaba registrada." -ForegroundColor Gray
    }

    if (Get-TaskInfo -TaskName "$taskAlertName-Noche") {
        Unregister-ScheduledTask -TaskName "$taskAlertName-Noche" -Confirm:$false
        Write-Host "[OK] Tarea '$taskAlertName-Noche' eliminada exitosamente." -ForegroundColor Green
    }

    if (Get-TaskInfo -TaskName $taskTelegramName) {
        Unregister-ScheduledTask -TaskName $taskTelegramName -Confirm:$false
        Write-Host "[OK] Tarea '$taskTelegramName' eliminada exitosamente." -ForegroundColor Green
    } else {
        Write-Host "  Tarea '$taskTelegramName' no estaba registrada." -ForegroundColor Gray
    }

    Write-Host ""
    Write-Host "Desinstalacion completada." -ForegroundColor Green
    Write-Host ""
    exit 0
}

if ($Action -eq "Install") {
    Write-Host ""
    Write-Host "Configurando Tareas Programadas de Produccion:" -ForegroundColor Cyan

    $settingsCommon = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest

    # 1. Registrar Tarea de Actualizador Automatico (05:00 AM)
    Write-Host "1. Creando tarea '$taskUpdateName' ($UpdateTime diario)..." -ForegroundColor DarkCyan
    $actionUpdate = New-ScheduledTaskAction -Execute $powershellExe -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$updateScript`"" -WorkingDirectory $repoRoot
    $triggerUpdate = New-ScheduledTaskTrigger -Daily -At $UpdateTime

    try {
        Register-ScheduledTask -TaskName $taskUpdateName -Action $actionUpdate -Trigger $triggerUpdate -Settings $settingsCommon -Principal $principal -Description "Actualizador automatico diario de TOCINETA via GitHub Releases con verificacion de hash y rollback." -Force | Out-Null
        Write-Host "  [OK] '$taskUpdateName' registrada exitosamente a las $UpdateTime." -ForegroundColor Green
    } catch {
        Write-Host "  [AVISO] No se pudo registrar via Register-ScheduledTask, intentando via schtasks.exe: $($_.Exception.Message)" -ForegroundColor Yellow
        $schCmd = "schtasks.exe /create /tn `"$taskUpdateName`" /tr `"$powershellExe -ExecutionPolicy Bypass -WindowStyle Hidden -File \`"$updateScript\`"`" /sc daily /st $UpdateTime /f"
        Invoke-Expression $schCmd
    }

    # 2. Registrar Tarea de Respaldo Cifrado hacia Drive (05:30 AM)
    Write-Host "2. Creando tarea '$taskBackupName' ($BackupTime diario)..." -ForegroundColor DarkCyan
    $actionBackup = New-ScheduledTaskAction -Execute $powershellExe -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$backupScript`"" -WorkingDirectory $repoRoot
    $triggerBackup = New-ScheduledTaskTrigger -Daily -At $BackupTime

    try {
        Register-ScheduledTask -TaskName $taskBackupName -Action $actionBackup -Trigger $triggerBackup -Settings $settingsCommon -Principal $principal -Description "Respaldo diario cifrado con Age hacia almacenamiento USB y Google Drive para el ERP TOCINETA." -Force | Out-Null
        Write-Host "  [OK] '$taskBackupName' registrada exitosamente a las $BackupTime." -ForegroundColor Green
    } catch {
        Write-Host "  [AVISO] No se pudo registrar via Register-ScheduledTask, intentando via schtasks.exe: $($_.Exception.Message)" -ForegroundColor Yellow
        $schCmd = "schtasks.exe /create /tn `"$taskBackupName`" /tr `"$powershellExe -ExecutionPolicy Bypass -WindowStyle Hidden -File \`"$backupScript\`"`" /sc daily /st $BackupTime /f"
        Invoke-Expression $schCmd
    }

    # 3. Registrar Tarea de Alertas por Telegram en Modo Daily (08:00 AM y 20:00 PM)
    Write-Host "3. Creando tarea '$taskAlertName' ($AlertTime y $AlertEveningTime diario)..." -ForegroundColor DarkCyan
    $actionAlert = New-ScheduledTaskAction -Execute $powershellExe -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$alertScript`" -Mode daily" -WorkingDirectory $repoRoot
    $triggerAlert1 = New-ScheduledTaskTrigger -Daily -At $AlertTime
    $triggerAlert2 = New-ScheduledTaskTrigger -Daily -At $AlertEveningTime
    $triggersAlert = @($triggerAlert1, $triggerAlert2)

    try {
        Register-ScheduledTask -TaskName $taskAlertName -Action $actionAlert -Trigger $triggersAlert -Settings $settingsCommon -Principal $principal -Description "Verificacion diaria de salud (modo daily) del sistema TOCINETA y notificaciones remotas via Telegram a las 08:00 y 20:00." -Force | Out-Null
        Write-Host "  [OK] '$taskAlertName' registrada exitosamente a las $AlertTime y $AlertEveningTime." -ForegroundColor Green
    } catch {
        Write-Host "  [AVISO] No se pudo registrar via Register-ScheduledTask, intentando via schtasks.exe: $($_.Exception.Message)" -ForegroundColor Yellow
        $schCmd1 = "schtasks.exe /create /tn `"$taskAlertName`" /tr `"$powershellExe -ExecutionPolicy Bypass -WindowStyle Hidden -File \`"$alertScript\`" -Mode daily`" /sc daily /st $AlertTime /f"
        $schCmd2 = "schtasks.exe /create /tn `"$taskAlertName-Noche`" /tr `"$powershellExe -ExecutionPolicy Bypass -WindowStyle Hidden -File \`"$alertScript\`" -Mode daily`" /sc daily /st $AlertEveningTime /f"
        Invoke-Expression $schCmd1
        Invoke-Expression $schCmd2
    }

    # 4. Registrar Tarea de Receptor de Actualizaciones y Comandos por Telegram (cada 15 minutos)
    Write-Host "4. Creando tarea '$taskTelegramName' (cada 15 minutos)..." -ForegroundColor DarkCyan
    $actionTelegram = New-ScheduledTaskAction -Execute $powershellExe -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$telegramScript`"" -WorkingDirectory $repoRoot
    $triggerTelegram = New-ScheduledTaskTrigger -Daily -At "00:00"
    $triggerTelegram.RepetitionInterval = (New-TimeSpan -Minutes 15)
    $triggerTelegram.RepetitionDuration = (New-TimeSpan -Days 3650)

    try {
        Register-ScheduledTask -TaskName $taskTelegramName -Action $actionTelegram -Trigger $triggerTelegram -Settings $settingsCommon -Principal $principal -Description "Receptor desatendido de actualizaciones y comandos de diagnostico por Telegram para TOCINETA (cada 15 minutos)." -Force | Out-Null
        Write-Host "  [OK] '$taskTelegramName' registrada exitosamente para ejecutarse cada 15 minutos." -ForegroundColor Green
    } catch {
        Write-Host "  [AVISO] No se pudo registrar via Register-ScheduledTask, intentando via schtasks.exe: $($_.Exception.Message)" -ForegroundColor Yellow
        $schCmd3 = "schtasks.exe /create /tn `"$taskTelegramName`" /tr `"$powershellExe -ExecutionPolicy Bypass -WindowStyle Hidden -File \`"$telegramScript\`"`" /sc minute /mo 15 /f"
        Invoke-Expression $schCmd3
    }

    Write-Host ""
    Write-Host "=================================================================" -ForegroundColor Green
    Write-Host "   TAREAS PROGRAMADAS CONFIGURADAS EXITOSAMENTE                 " -ForegroundColor Green
    Write-Host "=================================================================" -ForegroundColor Green
    Write-Host "- Actualizador Automatico:   $UpdateTime (Diario)" -ForegroundColor Gray
    Write-Host "- Respaldo Cifrado a Drive: $BackupTime (Diario)" -ForegroundColor Gray
    Write-Host "- Alertas de Salud Telegram: $AlertTime y $AlertEveningTime (Diario, modo daily)" -ForegroundColor Gray
    Write-Host "- Actualizador Telegram:    Cada 15 minutos" -ForegroundColor Gray
    Write-Host "Para verificar su ejecucion o administrarlas, abra 'taskschd.msc' en Windows." -ForegroundColor DarkGray
    Write-Host ""
}
