# All startup decisions are logged before returning to the scheduled task.
function Write-LocalAttempt {
  param([string]$Path, [hashtable]$Attempt, [string]$Status, [string]$Reason, [string]$Phase)
  $Attempt.status = $Status
  $Attempt.reason = $Reason
  $Attempt.phase = $Phase
  $Attempt.updated_at = (Get-Date).ToUniversalTime().ToString('o')
  $temporaryPath = "$Path.$PID.tmp"
  $Attempt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
  Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
  Write-Host "Disparo local: $Status - $Reason"
}

function Enter-LocalPublisher {
  param([string]$Root, [string]$Marker, [int]$CooldownHours = 3,
    [int]$WaitSeconds = 180, [switch]$Force, [scriptblock]$OnState,
    [scriptblock]$BusyCheck = {
      param($RepositoryRoot)
      @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -match '^node(?:\.exe)?$' -and $_.CommandLine -like "*$RepositoryRoot*" -and
        $_.CommandLine -match '(?:^|[\s"\\/])(?:run-monitors-and-notify|monitor-mercadolivre-all)\.mjs(?:[\s"]|$)' -and
        $_.CommandLine -notmatch '--skip-monitors'
      }).Count -gt 0
    })
  if (-not $Force -and (Test-Path -LiteralPath $Marker)) {
    try {
      $lastRun = [datetimeoffset]::Parse((Get-Content -LiteralPath $Marker -Raw).Trim())
      $age = ([datetimeoffset]::Now - $lastRun).TotalHours
      # Future or corrupt markers must never suppress collection indefinitely.
      if ($age -ge 0 -and $age -lt $CooldownHours) {
        return @{ acquired = $false; status = 'skipped'; exit_code = 0; reason = "Cooldown: publicacao concluida ha $([math]::Round($age, 2))h." }
      }
    } catch { Write-Host 'Marcador de ultima publicacao invalido; seguindo com o disparo.' }
  }
  $hash = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Root.ToLowerInvariant()))).Replace('-', '')
  # v1 could remain owned by an idle interactive ML terminal after its script
  # finished. Both publishers now use v2 and always release it in finally.
  # BusyCheck still protects collectors started with the previous protocol.
  $mutex = [System.Threading.Mutex]::new($false, "Local\OlxDailyPublisher-v2-$hash")
  $deadline = (Get-Date).AddSeconds([math]::Max(0, $WaitSeconds))
  try {
    $waitingRecorded = $false
    do {
      $acquired = $false
      if (-not (& $BusyCheck $Root)) {
        try { $acquired = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $acquired = $true }
      }
      if ($acquired) {
        # Another publisher may have completed while this attempt was waiting.
        if (-not $Force -and (Test-Path -LiteralPath $Marker)) {
          try {
            $lastRun = [datetimeoffset]::Parse((Get-Content -LiteralPath $Marker -Raw).Trim())
            $age = ([datetimeoffset]::Now - $lastRun).TotalHours
            if ($age -ge 0 -and $age -lt $CooldownHours) {
              $mutex.ReleaseMutex(); $mutex.Dispose()
              return @{ acquired = $false; status = 'skipped'; exit_code = 0; reason = 'Outra rodada concluiu a publicacao durante a espera; cooldown ativo.' }
            }
          } catch { Write-Host 'Nao foi possivel reler o marcador; seguindo com o publicador reservado.' }
        }
        return @{ acquired = $true; mutex = $mutex; status = 'running'; exit_code = 0; reason = 'Publicador reservado.' }
      }
      if (-not $waitingRecorded -and $OnState) { & $OnState 'waiting' 'Outra coleta/publicacao ativa; aguardando liberacao.'; $waitingRecorded = $true }
      $remainingMs = [int][math]::Max(0, ($deadline - (Get-Date)).TotalMilliseconds)
      if ($remainingMs -gt 0) { Start-Sleep -Milliseconds ([math]::Min(5000, $remainingMs)) }
    } while ((Get-Date) -lt $deadline)
    $mutex.Dispose()
    return @{ acquired = $false; status = 'deferred'; exit_code = 1; reason = 'Publicador ocupado apos espera limitada; nova tentativa deve ser feita pelo Agendador.' }
  } catch { $mutex.Dispose(); throw }
}
