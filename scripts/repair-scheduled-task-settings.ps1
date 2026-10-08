#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$logPath = Join-Path $logDir 'repair-scheduled-tasks.log'
try {
  foreach ($name in @('Monitor-OLX-0700', 'Monitor-OLX-1600', 'Monitor-OLX-Catchup')) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction Stop
    $task.Settings.StartWhenAvailable = $true
    $task.Settings.DisallowStartIfOnBatteries = $false
    $task.Settings.StopIfGoingOnBatteries = $false
    $task.Settings.ExecutionTimeLimit = 'PT4H'
    Set-ScheduledTask -InputObject $task -ErrorAction Stop | Out-Null
  }
  'OK: horarios perdidos recuperados, bateria permitida, limite de quatro horas.' | Set-Content -LiteralPath $logPath
} catch {
  "ERRO: $($_.Exception.Message)" | Set-Content -LiteralPath $logPath
  throw
}
