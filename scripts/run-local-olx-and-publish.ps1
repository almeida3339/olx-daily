param(
  [int]$MaxPerCpu = 12,
  [switch]$NoNotify,
  [switch]$NoPush,
  [int]$WaitForInternetSeconds = 300,
  [switch]$Force,
  [int]$CooldownHours = 3
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")

# Trava de repeticao: as tarefas Monitor-OLX-0700/1600 repetem a cada 10 min por
# 2h (retry de seguranca contra o PC acordar do modo suspenso bem na hora do
# disparo, ver commit deste comentario). O Agendador nao sabe distinguir "ja deu
# certo, pode parar" de "ainda nao rodou" - ele so repete cego. Sem esta trava,
# uma rodada bem-sucedida as 07:00 disparava de novo as 07:10, 07:20... ate 09:00
# (e o mesmo as 16h), rodando o monitor ~12x por gatilho em vez de 1x (visto em
# 07/08: 6 rodadas completas no dia por causa disso). O cooldown usa o mesmo
# marcador de sucesso que ja existia (.monitor-olx-enjoei-last-run) - se uma
# rodada completa (monitor + publicacao) terminou ha menos de $CooldownHours,
# esta e um no-op instantaneo. 3h cobre a janela de repeticao (2h) com folga sem
# bloquear o proximo gatilho legitimo 9h depois. -Force ignora a trava (uso
# manual deliberado, como preencher uma coleta que faltou).
$lastRunMarker = Join-Path $env:USERPROFILE ".monitor-olx-enjoei-last-run"
if (-not $Force -and (Test-Path $lastRunMarker)) {
  try {
    $lastRun = Get-Date (Get-Content $lastRunMarker -Raw)
    $elapsedHours = ((Get-Date) - $lastRun).TotalHours
    if ($elapsedHours -lt $CooldownHours) {
      Write-Host "Ultima rodada completa ha $([math]::Round($elapsedHours,1))h (< ${CooldownHours}h) - pulando (provavel disparo repetido do Agendador). Use -Force para rodar mesmo assim."
      exit 0
    }
  } catch {
    Write-Host "Aviso: nao consegui ler o marcador de ultima rodada ($lastRunMarker); seguindo normalmente."
  }
}

# A task agendada roda com -WindowStyle Hidden: sem transcript, toda a saida (e
# qualquer erro) se perde. Foi por isso que 8 rodadas seguidas morreram no rebase
# entre 21/07 e 25/07 sem deixar rastro nenhum - o unico sinal era um exit code 1
# (NAO use travessao/acento neste arquivo: ele nao tem BOM, o PowerShell 5.1 le
# como CP1252 e o byte 0x94 do travessao vira aspas, quebrando o parser.)
# no Agendador de Tarefas. Os logs ficam em logs/ (ja coberto por *.log no
# .gitignore) e sao podados para as 30 rodadas mais recentes.
$logDir = Join-Path $root "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir ("run-local-olx-{0}.log" -f (Get-Date -Format "yyyy-MM-dd_HHmmss"))
try { Start-Transcript -Path $logFile | Out-Null } catch {}
Get-ChildItem $logDir -Filter "run-local-olx-*.log" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 |
  Remove-Item -Force -ErrorAction SilentlyContinue

# A tarefa das 07:00 costuma rodar logo apos o PC ligar, quando o Wi-Fi/rede
# ainda nao conectou. Sem isso, o primeiro acesso de rede (git fetch / scraping)
# falharia de imediato. Aqui aguardamos a conectividade ficar disponivel (ate
# WaitForInternetSeconds) antes de comecar; assim que a rede sobe, seguimos.
function Wait-ForInternet {
  param([int]$TimeoutSeconds = 300, [int]$IntervalSeconds = 15)
  $probeHosts = @("github.com", "www.olx.com.br")
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    foreach ($h in $probeHosts) {
      try {
        $client = New-Object System.Net.Sockets.TcpClient
        $async = $client.BeginConnect($h, 443, $null, $null)
        $connected = $async.AsyncWaitHandle.WaitOne(4000, $false) -and $client.Connected
        $client.Close()
        if ($connected) { return $true }
      } catch {
        try { $client.Close() } catch {}
      }
    }
    Write-Host "Sem conexao ainda; aguardando ${IntervalSeconds}s e tentando de novo..."
    Start-Sleep -Seconds $IntervalSeconds
  }
  return $false
}

if (-not (Wait-ForInternet -TimeoutSeconds $WaitForInternetSeconds)) {
  Write-Host "Internet indisponivel apos ${WaitForInternetSeconds}s de espera; abortando rodada (a proxima tentara de novo)."
  exit 0
}
Write-Host "Conexao disponivel. Iniciando rodada."

$env:OLX_DATA_DIR = Join-Path $root "data\olx"
$env:ENJOEI_DATA_DIR = Join-Path $root "data\enjoei"
$env:ENJOEI_NOTEBOOKS_DATA_DIR = Join-Path $root "data\enjoei-notebooks"
$env:DOCKSTATIONS_DATA_DIR = Join-Path $root "data\dockstations"
$env:FITBIT_DATA_DIR = Join-Path $root "data\fitbit"
$env:LIFEFACTORY_DATA_DIR = Join-Path $root "data\lifefactory"
$env:TELA_GALAXYBOOK3_DATA_DIR = Join-Path $root "data\tela-galaxybook3"
$env:MELANGER_DATA_DIR = Join-Path $root "data\melanger"
$env:GALAXY_BUDS4_PRO_DATA_DIR = Join-Path $root "data\galaxy-buds4-pro"
$env:ONEPLUS_BUDS_PRO3_DATA_DIR = Join-Path $root "data\oneplus-buds-pro-3"
$env:GOOGLE_PIXEL_WATCH4_DATA_DIR = Join-Path $root "data\google-pixel-watch-4"
$env:GOOGLE_PIXEL_WATCH5_DATA_DIR = Join-Path $root "data\google-pixel-watch-5"
$env:OURA_RING5_DATA_DIR = Join-Path $root "data\oura-ring5"
$env:OLED_MONITORES_DATA_DIR = Join-Path $root "data\oled-monitores"
$env:MERCADOLIVRE_PROFILE_DIR = Join-Path $root ".chrome-mercadolivre-profile"
$env:OLX_MAX_PER_CPU = "$MaxPerCpu"

$fullSuccess = $false

Push-Location $root
try {
  function Get-RegisteredStagePaths {
    $foldersJson = node (Join-Path $PSScriptRoot "list-watchlist-folders.mjs") --all
    if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel ler o registry de watchlists." }
    # Windows PowerShell 5.1 returns a JSON array as one nested Object[] when
    # wrapped in @(...), turning all watchlist paths into a single space-joined
    # path. Let ConvertFrom-Json's array output enumerate directly instead.
    $registeredFolders = $foldersJson | ConvertFrom-Json
    $paths = @("data/status")
    # Construa os pathspecs diretamente do registry. Enumerar as pastas
    # existentes pode omitir diretórios criados durante a coleta em outra
    # sessão/processo, exatamente quando precisam entrar no commit.
    $paths += @($registeredFolders | ForEach-Object { "data/$_" })
    if (Test-Path -LiteralPath "index.html") { $paths += "index.html" }
    return @($paths | Select-Object -Unique)
  }

  function Add-RegisteredStagePaths {
    param([string[]]$Paths)
    # O antigo `git add -- $stagePaths` era sensivel a expansao de arrays no
    # PowerShell; a forma equivalente abaixo adiciona cada path explicitamente.
    $pathsToStage = @($Paths | Where-Object { $_ -and (Test-Path -LiteralPath $_) })
    Write-Host "Preparando staging de $($pathsToStage.Count) caminho(s) gerado(s)."
    foreach ($stagePath in $pathsToStage) {
      # --all inclui arquivos novos e remocoes feitas pelo saneamento de runs.
      # As aspas mantem cada path como um unico argumento no PowerShell 5.1.
      & git add --all -- "$stagePath"
      if ($LASTEXITCODE -ne 0) { throw "git add falhou para $stagePath (exit $LASTEXITCODE)." }
    }
  }

  # Esta rodada pode levar ~1h (pacing do OLX, ver 58ef35a0) com outra
  # sessao/ferramenta editando arquivos de codigo do repo ao vivo enquanto
  # isso acontece (observado varias vezes em 25/09 - este proprio arquivo em
  # edicao bem na hora da publicacao). git rebase recusa rodar com QUALQUER
  # arquivo rastreado modificado, mesmo fora do allowlist de dados - "cannot
  # rebase: You have unstaged changes", travando a publicacao apesar dos dados
  # ja estarem commitados. As duas funcoes abaixo isolam essas edicoes
  # externas com stash antes do rebase e devolvem depois: a mudanca fica
  # intacta no disco (git stash nao apaga nada, so tira da arvore de trabalho
  # temporariamente), so nao atrapalha mais o precondition check do rebase.
  # A saida do "git stash push" e descartada (*> $null) de proposito: sem
  # isso ela entra no stream de retorno da funcao e corrompe o [bool] que
  # Restore-ExternalEdits espera (bug pego em teste isolado antes de publicar).
  function Backup-ExternalEdits {
    param([string[]]$RegisteredPaths)
    $modified = @(git diff --name-only)
    $external = @($modified | Where-Object { $_ -and ($RegisteredPaths -notcontains $_) })
    if ($external.Count -eq 0) { return $false }
    Write-Host "Isolando edicoes externas antes do rebase (nao sao dados gerados por esta rodada): $($external -join ', ')"
    $stashArgs = @('stash', 'push', '--message', 'run-local-olx: edicoes externas isoladas temporariamente', '--') + $external
    & git @stashArgs *> $null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "Aviso: nao foi possivel isolar as edicoes externas; seguindo mesmo assim (rebase pode falhar)."
      return $false
    }
    return $true
  }

  function Restore-ExternalEdits {
    param([bool]$HasStash)
    if (-not $HasStash) { return }
    git stash pop *> $null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "Aviso: falha ao devolver as edicoes externas isoladas (git stash pop). Rode 'git stash list' manualmente para recuperar."
    }
  }

  # Uma rodada interrompida depois da coleta deixa snapshots locais na arvore.
  # Recupere somente os caminhos gerados pelo registry antes do rebase; assim
  # a proxima tentativa nao fica bloqueada por "unstaged changes" e nunca
  # incorpora um arquivo de codigo que o usuario esteja editando.
  $recoveryStagePaths = @(Get-RegisteredStagePaths)
  $dirtyGeneratedPaths = @($recoveryStagePaths | Where-Object {
    @((git status --porcelain -- $_)).Count -gt 0
  })
  $stagedOutsideRegistry = @(git diff --cached --name-only | Where-Object {
    $_ -and ($recoveryStagePaths -notcontains $_)
  })
  if ($stagedOutsideRegistry.Count -gt 0) {
    throw "Existem arquivos staged fora dos dados gerados: $($stagedOutsideRegistry -join ', '). Commit/stash manual necessario."
  }
  if ($dirtyGeneratedPaths.Count -gt 0) {
    Add-RegisteredStagePaths -Paths $dirtyGeneratedPaths
    $unstagedGenerated = @($dirtyGeneratedPaths | Where-Object {
      @((git status --porcelain -- $_)).Count -gt 0
    })
    if ($unstagedGenerated.Count -gt 0) {
      throw "Nao foi possivel preparar os dados gerados: $($unstagedGenerated -join ', ')."
    }
    if (-not (git diff --staged --quiet)) {
      $recoveryStamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm")
      git commit -m "snapshots olx local recovery $recoveryStamp"
      if ($LASTEXITCODE -ne 0) { throw "git commit de recuperacao falhou (exit $LASTEXITCODE)." }
    }
  }

  # ── Guard anti-rebase-preso ───────────────────────────────────────────────
  # Se uma rodada anterior morreu no meio de um rebase (ex.: timeout de 20 min
  # da task agendada), o repositorio fica preso em "rebase in progress". Sem
  # limpar, o git commit/push abaixo rodaria sobre um HEAD destacado e corromperia
  # o historico — foi exatamente o que travou as publicacoes em 29/05.
  $gitDir = (git rev-parse --git-dir).Trim()
  if ((Test-Path (Join-Path $gitDir "rebase-merge")) -or (Test-Path (Join-Path $gitDir "rebase-apply"))) {
    Write-Host "Rebase incompleto de uma rodada anterior detectado — abortando para limpar o estado."
    git rebase --abort 2>$null
  }

  # ── Sincronizar com o remoto ──────────────────────────────────────────────
  # index.html e gerado e muda em toda rodada (local e CI), entao conflita com
  # frequencia no rebase. Como ele e regenerado logo abaixo a partir de data/,
  # resolvemos qualquer conflito automaticamente com -X theirs (os dados ficam em
  # pastas separadas — data/olx vs data/enjoei* — e nao conflitam entre si).
  # Qualquer falha inesperada: abortar e sair. NUNCA commitar com rebase pela metade.
  #
  # merge.renames=false e OBRIGATORIO aqui. Cada rodada apaga o snapshot antigo e
  # grava um novo, com nome diferente e conteudo parecido - a deteccao de rename do
  # git enxerga isso como "snapshot-<antigo>.json renomeado para snapshot-<novo>.json".
  # Como CI e local renomeiam o MESMO arquivo antigo para nomes diferentes, o git
  # levanta conflito rename/rename, que e de ARVORE: -X theirs so resolve conteudo e
  # nao cobre esse caso. O rebase entao abortava, o push nunca saia e as rodadas de
  # OLX ficavam presas so no disco local (21/07 a 25/07 = 8 rodadas perdidas, sem
  # nenhum rastro porque a task roda -WindowStyle Hidden e nao gravava log).
  # Sem deteccao de rename, cada lado apenas adiciona/remove seus proprios arquivos
  # em pastas que nao colidem, e o rebase casa limpo.
  git fetch origin
  if ($LASTEXITCODE -ne 0) { throw "git fetch falhou (exit $LASTEXITCODE)." }

  $hasStashedEdits = Backup-ExternalEdits -RegisteredPaths $recoveryStagePaths
  git -c merge.renames=false -c core.editor=true rebase -X theirs origin/main
  $rebaseExit = $LASTEXITCODE
  Restore-ExternalEdits -HasStash $hasStashedEdits
  if ($rebaseExit -ne 0) {
    Write-Host "Rebase nao concluiu automaticamente — abortando para nao corromper o historico."
    git rebase --abort 2>$null
    throw "Falha ao sincronizar com origin/main; estado limpo. Rodada abortada (a proxima tentara de novo)."
  }

  # ── Monitor + dashboard (processos node) ──────────────────────────────────
  # Estes scripts node escrevem avisos em stderr (ex.: "Email nao enviado") sem
  # que isso seja uma falha fatal — eles sinalizam erro real apenas via exit code
  # (verificado logo abaixo). Sob $ErrorActionPreference='Stop', porem, qualquer
  # stderr de um comando nativo PODE virar erro terminante (especialmente se a
  # saida for redirecionada/mesclada), abortando a publicacao ANTES do commit e
  # do push — ou seja, perderiamos dados ja coletados so porque o email falhou.
  # Rodamos com 'Continue' e confiamos exclusivamente no $LASTEXITCODE.
  $prevEAP = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  if ($NoNotify) {
    & (Join-Path $PSScriptRoot "run-olx-monitor.ps1") -MaxPerCpu $MaxPerCpu
  } else {
    & node (Join-Path $PSScriptRoot "run-monitors-and-notify.mjs") --only-olx --olx-max-per-cpu $MaxPerCpu
  }
  $monitorExit = $LASTEXITCODE
  $monitorFailed = $monitorExit -ne 0

  if ($NoPush) {
    # Sem publicar: regenera o dashboard localmente apenas para inspecao.
    & node (Join-Path $PSScriptRoot "generate-dashboard.mjs")
    $dashExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEAP
    if ($dashExit -ne 0) { throw "Geracao do dashboard falhou com exit code $dashExit." }
    Write-Host "NoPush ativo: dashboard regenerado, nada commitado/publicado."
    if ($monitorFailed) {
      throw "Monitor OLX local falhou com exit code $monitorExit."
    }
    exit 0
  }

  # As operacoes git abaixo emitem avisos benignos em stderr — "LF will be
  # replaced by CRLF" ao indexar index.html, e o progresso do push. Sob
  # ErrorActionPreference='Stop' com a saida redirecionada, esse stderr vira erro
  # terminante e aborta ANTES do commit/push. O que importa e o exit code: rodamos
  # com 'Continue' e verificamos commit/push explicitamente.
  $ErrorActionPreference = 'Continue'

  # (1) Commita os dados coletados localmente (OLX/dockstations/fitbit). O
  # dashboard NAO entra aqui — ele e gerado adiante, ja sincronizado com o CI.
  # Algumas watchlists do Mercado Livre sao opcionais e so criam a pasta no
  # primeiro ciclo bem-sucedido. Filtrar os caminhos existentes evita que um
  # pathspec ausente interrompa a publicacao de todos os outros monitores.
  # O registry Node é a fonte única, mas a publicação continua com allowlist:
  # uma pasta arbitrária em data/ nunca deve ser enviada ao repositório público.
  # O fluxo local preserva também snapshots ML já existentes no checkout,
  # como fazia a allowlist anterior; a segurança vem do registry, não de um
  # filtro por plataforma.
  $stagePaths = @(Get-RegisteredStagePaths)
  $missingStagePaths = @($stagePaths | Where-Object { -not (Test-Path -LiteralPath $_) })
  if ($missingStagePaths.Count -gt 0) {
    Write-Host "Ignorando pastas de dados ainda inexistentes: $($missingStagePaths -join ', ')"
  }
  $stagePaths = @($stagePaths | Where-Object { Test-Path -LiteralPath $_ })
  Write-Host "Caminhos registrados para publicar ($($stagePaths.Count)): $($stagePaths -join ', ')"
  if ($stagePaths.Count -gt 0) { Add-RegisteredStagePaths -Paths $stagePaths }
  $unstagedTrackedGenerated = @()
  $untrackedGenerated = @()
  foreach ($stagePath in $stagePaths) {
    $unstagedTrackedGenerated += @(git diff --name-only -- "$stagePath")
    $untrackedGenerated += @(git ls-files --others --exclude-standard -- "$stagePath")
  }
  $remainingGenerated = @(@($unstagedTrackedGenerated) + @($untrackedGenerated) | Where-Object { $_ } | Select-Object -Unique)
  if ($remainingGenerated.Count -gt 0) {
    throw "Dados gerados ficaram fora do staging; publicacao interrompida antes do rebase: $($remainingGenerated -join ', ')."
  }
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm")
  $localCommitExists = $false
  if (-not (git diff --staged --quiet)) {
    git commit -m "snapshots olx local $stamp"
    if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = $prevEAP; throw "git commit falhou (exit $LASTEXITCODE)." }
    $localCommitExists = $true
  }

  # (2) Publica. O dashboard e regenerado DENTRO do loop, sempre DEPOIS de
  # sincronizar com origin, para refletir tambem o que o CI (Enjoei) publicou
  # durante a nossa coleta. Antes, o dashboard era gerado com dados defasados e o
  # -X theirs fazia o index.html local sobrescrever o do CI — escondendo, p.ex., a
  # queda de preco de um tenis ja coletada pelo CI (incidente 03/06 16h). O push
  # tambem compete com o CI por main, entao re-sincronizamos a cada tentativa.
  $pushed = $false
  # Isolado uma vez fora do loop (nao a cada tentativa): a edicao externa que
  # bloqueia o rebase tende a persistir por toda a publicacao (~alguns
  # segundos a minutos), entao um unico stash/pop em volta das 4 tentativas
  # basta e evita empilhar stashes desnecessarios.
  $hasStashedPublishEdits = Backup-ExternalEdits -RegisteredPaths $stagePaths
  try {
  for ($attempt = 1; $attempt -le 4 -and -not $pushed; $attempt++) {
    git fetch origin
    if ($LASTEXITCODE -ne 0) { Write-Host "fetch falhou (tentativa $attempt/4); nova tentativa."; Start-Sleep -Seconds 3; continue }

    git -c merge.renames=false -c core.editor=true rebase -X theirs origin/main
    if ($LASTEXITCODE -ne 0) {
      $rebaseDir = (git rev-parse --git-dir).Trim()
      if ((Test-Path (Join-Path $rebaseDir "rebase-merge")) -or (Test-Path (Join-Path $rebaseDir "rebase-apply"))) {
        & git rebase --abort *> $null
      }
      $ErrorActionPreference = $prevEAP
      throw "Rebase pre-push falhou; estado limpo. Rodada abortada (a proxima tentara de novo)."
    }

    # Regenera o dashboard com OLX local (ja commitado) + dados do CI recem-trazidos.
    & node (Join-Path $PSScriptRoot "generate-dashboard.mjs")
    if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = $prevEAP; throw "Geracao do dashboard falhou (exit $LASTEXITCODE)." }
    # O dashboard atualiza monitor-health.json em toda rodada. Incluí-lo no
    # mesmo commit evita deixar a árvore suja e quebrar o rebase seguinte.
    git add index.html data/status
    if (-not (git diff --staged --quiet)) {
      if ($localCommitExists) {
        git commit --amend --no-edit
      } else {
        git commit -m "dashboard local $stamp"
        $localCommitExists = $true
      }
      if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = $prevEAP; throw "git commit (dashboard) falhou (exit $LASTEXITCODE)." }
    }

    # Nada a publicar (sem dados OLX novos e dashboard identico ao do origin).
    $ahead = [int](git rev-list --count "origin/main..HEAD")
    if ($ahead -eq 0) { Write-Host "Nada novo a publicar."; $pushed = $true; break }

    git push origin main
    if ($LASTEXITCODE -eq 0) { $pushed = $true; break }
    Write-Host "Push rejeitado (tentativa $attempt/4) - re-sincronizando com origin/main."
  }
  } finally {
    Restore-ExternalEdits -HasStash $hasStashedPublishEdits
  }
  if (-not $pushed) { $ErrorActionPreference = $prevEAP; throw "git push falhou apos 4 tentativas." }

  # O marcador (usado pela trava de cooldown acima E por startup-catchup.ps1)
  # so deve depender de $pushed - ja publicamos os dados bons, entao esta
  # rodada cumpriu seu papel. NAO usar "-not $monitorFailed" aqui: isso exige
  # ZERO erros pontuais (ex.: 1 termo de CPU entre ~30 dando timeout), o que
  # raramente acontece numa rodada inteira - o marcador ficava "velho" na
  # maioria dos dias mesmo com tudo publicado certo. Isso quebrava as duas
  # travas que dependem dele: o cooldown de repeticao (sem efeito, rodava tudo
  # de novo) e o startup-catchup.ps1 (disparava rodada completa em qualquer
  # boot seguinte, achando que passou dos 9h sem sucesso). Explicava rodadas
  # extras em horarios aleatorios (19:25, 19:43, 20:17...) vistas quase todo
  # dia entre 10/08 e 26/08. $monitorFailed continua fazendo o script sair
  # com erro (visivel no Agendador) - so nao bloqueia mais o marcador.
  if ($pushed) {
    $fullSuccess = $true
  }

  $ErrorActionPreference = $prevEAP

  if ($monitorFailed) {
    throw "Monitor OLX local falhou com exit code $monitorExit."
  }
} finally {
  Pop-Location
  # Registrar timestamp apenas quando a run completou sem erros de monitor ou publicacao.
  # O startup-catchup.ps1 usa este arquivo para decidir se deve rodar.
  if ($fullSuccess) {
    (Get-Date -Format "o") | Set-Content (Join-Path $env:USERPROFILE ".monitor-olx-enjoei-last-run")
    Write-Host "Timestamp registrado: $(Get-Date -Format 'dd/MM HH:mm')"
  }
  try { Stop-Transcript | Out-Null } catch {}
}
