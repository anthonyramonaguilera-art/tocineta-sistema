$logDir = "C:\ProgramData\Tocineta"
if (!(Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$logFile = "$logDir\spooler.log"

function Write-SpoolerLog($msg) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "[$timestamp] $msg" | Out-File -FilePath $logFile -Append -Encoding utf8
    if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 1MB)) {
        if (Test-Path "$logFile.1") { Remove-Item "$logFile.1" -Force }
        Rename-Item $logFile "spooler.log.1" -Force
    }
}

try {
    $spooler = Get-Service Spooler -ErrorAction SilentlyContinue
    if ($null -eq $spooler) { exit }

    if ($spooler.Status -ne 'Running' -or $spooler.Status -eq 'StopPending') {
        Start-Sleep -Seconds 2
        $spooler = Get-Service Spooler
        if ($spooler.Status -eq 'StopPending' -or $spooler.Status -ne 'Running') {
            Write-SpoolerLog "Spooler no está Running o está trabado. Reiniciando servicio..."
            Restart-Service Spooler -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 3
        }
    }

    $stuckJobs = Get-PrintJob -ErrorAction SilentlyContinue | Where-Object { 
        $_.DocumentName -like 'Tocineta_*' -and ($_.JobStatus -eq 'Error' -or $_.JobStatus -eq 'Deleting' -or ($_.JobStatus -eq 'Printing' -and ((Get-Date) - $_.SubmittedTime).TotalSeconds -gt 60))
    }

    if ($stuckJobs) {
        Write-SpoolerLog "Detectados trabajos de Tocineta atascados en el Spooler. Purgando cola y reiniciando spooler..."
        Stop-Service Spooler -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        if (Test-Path "C:\Windows\System32\spool\PRINTERS") {
            Remove-Item "C:\Windows\System32\spool\PRINTERS\*" -Force -ErrorAction SilentlyContinue
        }
        Start-Service Spooler -ErrorAction SilentlyContinue
        Write-SpoolerLog "Spooler reiniciado y cola limpia."
    }
} catch {
    Write-SpoolerLog "Error en spooler-watch: $_"
}
