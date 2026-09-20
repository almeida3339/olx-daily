// Comandos usados pelos botões "Disparar" do dashboard público.
// Mantém caminhos relativos/portáveis e nunca expõe o diretório local do autor.
export function buildLocalTriggerCommands(root = null) {
  if (!root) {
    const repoSetup = "$repo = $env:OLX_DAILY_REPO; if (-not $repo) { $repo = Join-Path $HOME 'Downloads\\olx-daily' }; ";
    const scriptPath = (name) => `(Join-Path $repo 'scripts\\${name}')`;
    return {
      olx: `${repoSetup}& ${scriptPath("run-local-olx-and-publish.ps1")}`,
      mercadoLivre: `${repoSetup}& ${scriptPath("run-mercadolivre-and-publish.ps1")}`,
      notificacoes: `${repoSetup}node ${scriptPath("manage-notification-outbox.mjs")}`,
    };
  }
  const scriptPath = (name) => `${root.replace(/[\\/]+$/, "")}\\scripts\\${name}`.replace(/'/g, "''");
  return {
    olx: `& '${scriptPath("run-local-olx-and-publish.ps1")}'`,
    mercadoLivre: `& '${scriptPath("run-mercadolivre-and-publish.ps1")}'`,
    notificacoes: `node '${scriptPath("manage-notification-outbox.mjs")}'`,
  };
}
