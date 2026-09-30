# Shared Git checks, compatible with Windows PowerShell 5.1.
function Test-RegisteredGeneratedPath {
  param([string]$FilePath, [string[]]$RegisteredPaths)
  $normalized = $FilePath.Replace('\', '/')
  foreach ($registeredPath in $RegisteredPaths) {
    $prefix = $registeredPath.Replace('\', '/').TrimEnd('/')
    if ($normalized -eq $prefix -or $normalized.StartsWith($prefix + '/', [StringComparison]::Ordinal)) {
      return $true
    }
  }
  return $false
}

function Get-UnstagedGeneratedFiles {
  param([string[]]$Paths)
  $files = @()
  foreach ($registeredPath in $Paths) {
    $files += @(git -c core.quotepath=false diff --name-only --no-renames -- "$registeredPath")
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel consultar as alteracoes fora do staging.' }
    $files += @(git -c core.quotepath=false ls-files --others --exclude-standard -- "$registeredPath")
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel consultar os arquivos novos.' }
  }
  return @($files | Where-Object { $_ } | Select-Object -Unique)
}

function Test-GitStagedChanges {
  git diff --staged --quiet
  $diffExit = $LASTEXITCODE
  if ($diffExit -eq 0) { return $false }
  if ($diffExit -eq 1) { return $true }
  throw "Nao foi possivel consultar o staging (exit $diffExit)."
}
