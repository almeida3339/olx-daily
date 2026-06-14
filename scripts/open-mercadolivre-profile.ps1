$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$profile = Join-Path $root ".chrome-mercadolivre-profile"
$chrome = "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path -LiteralPath $chrome)) {
  $chrome = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
}
if (-not (Test-Path -LiteralPath $chrome)) {
  throw "Chrome nao encontrado."
}

Write-Host "Abrindo o perfil exclusivo do Mercado Livre."
Write-Host "Entre manualmente e feche esta janela do Chrome antes de rodar o monitor."
Start-Process -FilePath $chrome -ArgumentList @(
  "--user-data-dir=`"$profile`"",
  "--profile-directory=Default",
  "https://www.mercadolivre.com.br/"
)
