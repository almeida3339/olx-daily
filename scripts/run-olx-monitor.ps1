param(
  [int]$Port = 9222,
  [int]$MaxPerCpu = 12,
  [switch]$OpenDetails,
  [switch]$ListingOnly,
  [switch]$Foreground,
  [switch]$ForceRestartChrome
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$versionUrl = "http://127.0.0.1:$Port/json/version"
function Get-NetstatForPort([int]$p) {
  $out = (& netstat -ano | Select-String -Pattern (":$p\\s") | ForEach-Object { $_.ToString() }) -join "`n"
  if ($out) { return $out }
  return "(nenhuma linha do netstat para :$p)"
}

function Test-Cdp {
  try {
    Invoke-RestMethod -Uri $versionUrl -TimeoutSec 3 | Out-Null
    return $true
  } catch {
    return $false
  }
}

# Sempre recicla o Chrome de debug do perfil OLX a cada rodada. Reusar o Chrome
# de execucoes anteriores acumula abas ao longo de dias e acaba travando o
# monitor (a porta 9222 fica viva mas a sessao degrada — incidente 03/06). O
# perfil persiste em disco, entao cookies/Cloudflare sao preservados; so o
# processo reinicia. ForceCloseProfile=$true forca fechar antes de subir fresco.
$chromeArgs = @{
  OlxProfile = $true
  Port = $Port
  Url = "https://www.olx.com.br"
  WaitSeconds = 90
  ForceCloseProfile = $true
}
if (-not $Foreground) {
  $chromeArgs.Background = $true
}
& (Join-Path $PSScriptRoot "start-chrome-debug.ps1") @chromeArgs

$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline) {
  if (Test-Cdp) {
    break
  }
  Start-Sleep -Seconds 1
}

if (-not (Test-Cdp)) {
  $net = Get-NetstatForPort -p $Port
  throw "Chrome CDP nao ficou disponivel em $versionUrl. netstat :${Port}:`n$net"
}

$npmArgs = @(
  "run",
  "-s",
  "monitor:olx-notebooks-por-cpu",
  "--",
  "--current-chrome",
  "--max-per-cpu",
  "$MaxPerCpu"
)

if ($OpenDetails) {
  $npmArgs += "--open-details"
}

if ($ListingOnly) {
  $npmArgs += "--listing-only"
}

Push-Location $root
try {
  & npm @npmArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Monitor OLX falhou com exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}
