$taskName = "TocinetaSpoolerWatch"
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Tarea programada '$taskName' eliminada exitosamente."
} else {
    Write-Host "La tarea programada '$taskName' no existe."
}
