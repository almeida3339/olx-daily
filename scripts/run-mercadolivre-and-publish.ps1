param(
  [switch]$Visible,   # mostra a janela do Chrome (login/desafios); padrao = invisivel
  [switch]$Recover,   # abre o perfil para recuperacao manual e valida a busca antes de coletar
  [switch]$FullSweep, # consulta todos os termos, mantendo os bloqueios de seguranca
  [switch]$NoPush     # coleta + regenera dashboard, sem commitar/publicar
)

# Rodamos SEMPRE sob 'Continue': comandos git/node sao nativos e emitem stderr
# benigno (progresso, avisos de CRLF). Sob 'Stop' no PowerShell 5.1 esse stderr
# vira erro terminante e mata o script antes de coletar. Verificamos $LASTEXITCODE
# explicitamente. Sem danca de $ErrorActionPreference (causava erro de null).
# Script em ASCII de proposito: acentos em .ps1 lido sem BOM no PS 5.1 quebram o parser.
$ErrorActionPreference = "Continue"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$env:MERCADOLIVRE_PROFILE_DIR = Join-Path $root ".chrome-mercadolivre-profile"
$autoStashRef = $null
Set-Location $root
. (Join-Path $PSScriptRoot 'lib\publication-git.ps1')

function Restore-LocalChanges {
  if (-not $script:autoStashRef) { return }
  Write-Host "Restaurando alteracoes locais preservadas..." -ForegroundColor Yellow
  git stash pop --index $script:autoStashRef
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Nao foi possivel restaurar automaticamente; suas alteracoes continuam guardadas em $script:autoStashRef." -ForegroundColor Yellow
    Write-Host "Resolva eventuais conflitos e use: git stash pop --index $script:autoStashRef" -ForegroundColor Yellow
    return
  }
  $script:autoStashRef = $null
}

function Save-LocalChanges {
  $dirty = git status --porcelain
  if (-not $dirty) { return }
  Write-Host "Alteracoes locais detectadas - guardando temporariamente para sincronizar com seguranca." -ForegroundColor Yellow
  $label = "mercadolivre-auto-stash-" + [guid]::NewGuid().ToString("N")
  git stash push --include-untracked --message $label | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "git stash falhou; nenhuma alteracao foi descartada." }
  $script:autoStashRef = (git stash list -1 --format="%gd").Trim()
  if (-not $script:autoStashRef) { Fail "Nao foi possivel localizar o backup temporario do Git." }
}

function Fail($msg) { Restore-LocalChanges; Write-Host "ERRO: $msg" -ForegroundColor Red; exit 1 }

Write-Host "=== Mercado Livre: coleta sob demanda ===" -ForegroundColor Cyan
# Stash/rebase cannot run while another publisher is writing this checkout.
$otherPublisher = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.ProcessId -ne $PID -and $_.Name -match 'powershell|pwsh|node' -and
  $_.CommandLine -like "*$root*" -and
  $_.CommandLine -match 'run-local-olx-and-publish|run-monitors-and-notify' -and
  $_.CommandLine -notmatch '--only-mercadolivre'
}
if ($otherPublisher) {
  Write-Host 'Outra coleta/publicacao esta em andamento. Aguarde sua conclusao antes de iniciar o ML.' -ForegroundColor Yellow
  exit 2
}
$mutexHash = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant()))).Replace('-', '')
$publisherMutex = [System.Threading.Mutex]::new($false, "Local\OlxDailyPublisher-$mutexHash")
try { $publisherAcquired = $publisherMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $publisherAcquired = $true }
if (-not $publisherAcquired) { $publisherMutex.Dispose(); Write-Host 'Publicador ocupado. Aguarde a conclusao da outra rodada.'; exit 2 }
Save-LocalChanges

# Guard anti-rebase-preso (uma rodada anterior pode ter morrido no meio de um rebase).
$gitDir = (git rev-parse --git-dir 2>$null | Out-String).Trim()
if ($gitDir -and ((Test-Path (Join-Path $gitDir "rebase-merge")) -or (Test-Path (Join-Path $gitDir "rebase-apply")))) {
  Write-Host "Rebase incompleto detectado - limpando."
  git rebase --abort 2>$null
}

Write-Host "[1/4] Sincronizando com o remoto..."
git fetch origin
if ($LASTEXITCODE -ne 0) { Fail "git fetch falhou exit $LASTEXITCODE." }
git -c core.editor=true rebase -X theirs origin/main
if ($LASTEXITCODE -ne 0) { git rebase --abort 2>$null; Fail "Falha ao sincronizar com origin/main." }

if ($Recover) {
  Write-Host "[2/4] Recuperando o perfil; resolva login/verificacao no Chrome..." -ForegroundColor Yellow
  node (Join-Path $PSScriptRoot "mercadolivre-recovery.mjs") --recover
  if ($LASTEXITCODE -ne 0) { Fail "Perfil ainda nao liberado. Coleta nao iniciada." }
} else {
  node (Join-Path $PSScriptRoot "mercadolivre-recovery.mjs") --check
  $checkExit = $LASTEXITCODE
  if ($checkExit -eq 2) {
    Write-Host "Disparo encerrado: nenhuma busca feita; nenhuma nova notificacao ou publicacao." -ForegroundColor Yellow
    Restore-LocalChanges
    exit 2
  }
  if ($checkExit -ne 0) { Fail "Nao foi possivel conferir o estado do perfil." }
}

$mlMode = if ($Visible -or $Recover) { "visivel" } else { "invisivel" }
Write-Host "[2/4] Coletando Mercado Livre - $mlMode; completando os termos pendentes em lotes..." -ForegroundColor Yellow
$mlStartedAt = [DateTime]::UtcNow.ToString("o")
$mlArgs = @('--complete-coverage'); if ($FullSweep) { $mlArgs += '--full-sweep' }; if ($Visible -or $Recover) { $mlArgs += @("--visible", "--load-assets") }
node (Join-Path $PSScriptRoot "monitor-mercadolivre-all.mjs") @mlArgs
$mlExit = $LASTEXITCODE
if ($mlExit -ne 0) { Write-Host "Aviso: coleta terminou com exit $mlExit - cobertura possivelmente parcial." -ForegroundColor Yellow }

Write-Host "[3/4] Regenerando dashboard..."
node (Join-Path $PSScriptRoot "generate-dashboard.mjs")
if ($LASTEXITCODE -ne 0) { Fail "Geracao do dashboard falhou exit $LASTEXITCODE." }

if ($NoPush) {
  Write-Host "NoPush ativo: dashboard regenerado, nada publicado." -ForegroundColor Yellow
  if ($mlExit -ne 0) { Fail "Coleta do Mercado Livre terminou com exit $mlExit." }
  Restore-LocalChanges
  exit 0
}

Write-Host "[3.5/4] Notificando somente os resultados desta coleta..."
$env:MONITOR_REPORT_MIN_TIME = $mlStartedAt
node (Join-Path $PSScriptRoot "run-monitors-and-notify.mjs") --only-mercadolivre
$notifyExit = $LASTEXITCODE
Remove-Item Env:MONITOR_REPORT_MIN_TIME -ErrorAction SilentlyContinue
if ($notifyExit -ne 0) { Write-Host "Aviso: notificacao terminou com exit $notifyExit." -ForegroundColor Yellow }

Write-Host "[4/4] Publicando..."
# O registry Node é a fonte única, mas a publicação usa apenas a allowlist ML;
# uma pasta arbitrária em data/ nunca deve ser enviada ao repositório público.
$registeredFoldersJson = node (Join-Path $PSScriptRoot "list-watchlist-folders.mjs") --mercadolivre
if ($LASTEXITCODE -ne 0) { Fail "Nao foi possivel ler o registry de watchlists." }
# PS 5.1 emits the JSON array as one object; @() would nest that array.
$registeredFolders = $registeredFoldersJson | ConvertFrom-Json
$mlStagePaths = @("data/status", "index.html")
$mlStagePaths += @(Get-ChildItem -LiteralPath "data" -Directory -ErrorAction SilentlyContinue |
  Where-Object { $registeredFolders -contains $_.Name } |
  ForEach-Object { "data/$($_.Name)" })
$missingMlStagePaths = @($mlStagePaths | Where-Object { -not (Test-Path -LiteralPath $_) })
if ($missingMlStagePaths.Count -gt 0) {
  Write-Host "Ignorando pastas do Mercado Livre ainda inexistentes: $($missingMlStagePaths -join ', ')"
}
$mlStagePaths = @($mlStagePaths | Where-Object { Test-Path -LiteralPath $_ })
if ($mlStagePaths.Count -gt 0) {
  & git add -- $mlStagePaths
  if ($LASTEXITCODE -ne 0) { Fail "git add falhou exit $LASTEXITCODE." }
}
if (-not (Test-GitStagedChanges)) {
  Write-Host "Nada novo do Mercado Livre para publicar." -ForegroundColor Green
  if ($mlExit -ne 0) { Fail "Coleta do Mercado Livre terminou com exit $mlExit." }
  if ($notifyExit -ne 0) { Fail "Notificacao ou resumo do Mercado Livre terminou com exit $notifyExit." }
  Restore-LocalChanges
  exit 0
}
$stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm")
git commit -m "snapshots mercadolivre $stamp" | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "git commit falhou exit $LASTEXITCODE." }

for ($attempt = 1; $attempt -le 4; $attempt++) {
  git push origin main
  if ($LASTEXITCODE -eq 0) {
    if ($mlExit -ne 0) { Fail "Dados publicados; coleta do Mercado Livre incompleta (exit $mlExit)." }
    if ($notifyExit -ne 0) { Fail "Dados publicados; notificacao ou resumo do Mercado Livre terminou com exit $notifyExit." }
    Restore-LocalChanges
    Write-Host "Publicado com sucesso." -ForegroundColor Green
    exit 0
  }
  Write-Host "Push rejeitado tentativa $attempt de 4 - re-sincronizando."
  git fetch origin
  if ($LASTEXITCODE -ne 0) { Fail "git fetch pre-push falhou exit $LASTEXITCODE." }
  git -c core.editor=true rebase -X theirs origin/main
  if ($LASTEXITCODE -ne 0) { git rebase --abort 2>$null; Fail "Rebase pre-push falhou; estado limpo." }
  node (Join-Path $PSScriptRoot "generate-dashboard.mjs")
  if ($LASTEXITCODE -ne 0) { Fail "Geracao do dashboard pre-push falhou exit $LASTEXITCODE." }
  git add index.html data/status/monitor-health.json
  if ($LASTEXITCODE -ne 0) { Fail "git add pre-push falhou exit $LASTEXITCODE." }
  if (Test-GitStagedChanges) { git commit --amend --no-edit | Out-Null }
}
Fail "git push falhou apos 4 tentativas."
