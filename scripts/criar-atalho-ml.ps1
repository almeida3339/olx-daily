# Cria um atalho "Rodar Mercado Livre" na Área de Trabalho.
# Depois é só clicar com o botão direito no atalho → "Fixar na barra de tarefas".
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$script = Join-Path $root "scripts\run-mercadolivre-and-publish.ps1"
$desktop = [Environment]::GetFolderPath("Desktop")
$lnkPath = Join-Path $desktop "Rodar Mercado Livre.lnk"

$chrome = "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path -LiteralPath $chrome)) { $chrome = "$env:SystemRoot\System32\shell32.dll" }

$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
# -NoExit/Read-Host mantém a janela aberta para você ver o resultado da coleta.
$lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -Command ""& '$script'; Read-Host 'Concluido. Enter para fechar'"""
$lnk.WorkingDirectory = $root
$lnk.IconLocation = $chrome
$lnk.Description = "Dispara a busca do Mercado Livre (invisível) e publica o dashboard"
$lnk.Save()

Write-Host "Atalho criado em: $lnkPath" -ForegroundColor Green
Write-Host "Para fixar na barra de tarefas: clique com o botao direito no atalho -> 'Mostrar mais opcoes' -> 'Fixar na barra de tarefas'."
Write-Host "Dica: para acompanhar a janela do Chrome (login/desafio), edite o atalho e troque o comando por: ... run-mercadolivre-and-publish.ps1 -Visible"
