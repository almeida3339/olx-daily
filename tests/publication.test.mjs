import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_WATCHLISTS } from "../scripts/lib/watchlists-registry.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("publicacao local inclui automaticamente as pastas registradas", async () => {
  const script = await fs.readFile(path.join(root, "scripts", "run-local-olx-and-publish.ps1"), "utf8");
  assert.match(script, /Get-ChildItem -LiteralPath "data" -Directory/);
  assert.match(script, /list-watchlist-folders\.mjs"\) --all/);
  assert.match(script, /\$registeredFolders -contains \$_.Name/);
  for (const watchlist of ALL_WATCHLISTS) {
    assert.ok(watchlist.repoFolder, `watchlist ${watchlist.id} precisa de pasta publicada`);
  }
});

test("publicacao dedicada do Mercado Livre inclui Monitores OLED e propaga falha da coleta", async () => {
  const script = await fs.readFile(path.join(root, "scripts", "run-mercadolivre-and-publish.ps1"), "utf8");
  assert.match(script, /\$registeredFolders -contains \$_.Name/);
  assert.match(script, /data\/status/);
  assert.match(script, /Coleta do Mercado Livre terminou com exit \$mlExit/);
});

test("publicacao dedicada do Mercado Livre preserva alteracoes locais antes de sincronizar", async () => {
  const script = await fs.readFile(path.join(root, "scripts", "run-mercadolivre-and-publish.ps1"), "utf8");
  assert.match(script, /git stash push --include-untracked/);
  assert.match(script, /git stash pop --index/);
  assert.match(script, /Save-LocalChanges/);
  assert.match(script, /Restore-LocalChanges/);
});

test("painel e notificacoes incluem Galaxy Buds4 Pro do Mercado Livre", async () => {
  const [dashboard, notifier] = await Promise.all([
    fs.readFile(path.join(root, "scripts", "generate-dashboard.mjs"), "utf8"),
    fs.readFile(path.join(root, "scripts", "run-monitors-and-notify.mjs"), "utf8"),
  ]);
  assert.match(dashboard, /watchlists-registry\.mjs/);
  assert.ok(ALL_WATCHLISTS.some((watchlist) => watchlist.id === "mercadolivre-galaxy-buds4-pro"));
  assert.match(notifier, /MERCADOLIVRE_WATCHLISTS/);
});

test("painel prioriza destaques recentes e recolhe a saúde detalhada", async () => {
  const dashboard = await fs.readFile(path.join(root, "scripts", "generate-dashboard.mjs"), "utf8");
  assert.match(dashboard, /Destaques de hoje/);
  assert.match(dashboard, /<details class="health-panel/);
  assert.ok(dashboard.indexOf("${highlightsHtml}") < dashboard.indexOf("${healthPanelHtml}"));
});

test("painel recolhe fontes sem novidades fora do grid principal", async () => {
  const dashboard = await fs.readFile(path.join(root, "scripts", "generate-dashboard.mjs"), "utf8");
  assert.match(dashboard, /const emptySources = sources\.filter/);
  assert.match(dashboard, /<details class="empty-sources/);
  assert.ok(dashboard.indexOf("${cardsHtml}") < dashboard.indexOf("${emptyCardsHtml}"));
});

test("painel usa nomes canônicos, preços padronizados e badge parcial âmbar", async () => {
  const [dashboard, health] = await Promise.all([
    fs.readFile(path.join(root, "scripts", "generate-dashboard.mjs"), "utf8"),
    fs.readFile(path.join(root, "scripts", "lib", "monitor-health.mjs"), "utf8"),
  ]);
  assert.match(dashboard, /formatBrlPrice/);
  assert.match(dashboard, /\.bw\{background:#3d2b00/);
  assert.match(dashboard, /cobertura parcial/);
  assert.match(health, /monitor-labels\.mjs/);
});

test("quedas de preço têm destaque visual e texto explícito", async () => {
  const dashboard = await fs.readFile(path.join(root, "scripts", "generate-dashboard.mjs"), "utf8");
  assert.match(dashboard, /\.delta\.down\{color:#56d364;background:#0f2417/);
  assert.match(dashboard, /↑ subiu/);
  assert.match(dashboard, /↓ caiu/);
  assert.doesNotMatch(dashboard, /\.delta\.up\{color:#f85149/);
});

test("botões de disparo mantêm o contexto em uma segunda linha", async () => {
  const dashboard = await fs.readFile(path.join(root, "scripts", "generate-dashboard.mjs"), "utf8");
  assert.match(dashboard, /\.trig\{[^}]*flex-direction:column/);
  assert.match(dashboard, /\.trig \.tip\{display:block/);
});

test("timestamps visíveis usam formato brasileiro e fuso explícito", async () => {
  const dashboard = await fs.readFile(path.join(root, "scripts", "generate-dashboard.mjs"), "utf8");
  assert.match(dashboard, /new Intl\.DateTimeFormat\("pt-BR"/);
  assert.match(dashboard, /\}\)\.format\(date\)\} BRT/);
  assert.doesNotMatch(dashboard, /DateTimeFormat\("sv-SE"/);
  assert.match(dashboard, /updatedDate\.toISOString\(\)/);
});

test("orquestrador inclui Monitores OLED nos achados notificáveis", async () => {
  const notifier = await fs.readFile(path.join(root, "scripts", "run-monitors-and-notify.mjs"), "utf8");
  assert.match(notifier, /getWatchlist\("oled-monitores"\)/);
  assert.match(notifier, /oledMonitoresReport/);
  assert.ok(ALL_WATCHLISTS.some((watchlist) => watchlist.id === "oled-monitores" && watchlist.label === "Monitores OLED"));
});

test("orquestrador inclui Google Pixel Watch 4 nos achados notificáveis", async () => {
  const notifier = await fs.readFile(path.join(root, "scripts", "run-monitors-and-notify.mjs"), "utf8");
  assert.match(notifier, /getWatchlist\("google-pixel-watch-4"\)/);
  assert.match(notifier, /pixelWatch4Report/);
  assert.ok(ALL_WATCHLISTS.some((watchlist) => watchlist.id === "google-pixel-watch-4" && watchlist.label === "Google Pixel Watch 4"));
});

test("orquestrador inclui Google Pixel Watch 5 nos achados notificáveis", async () => {
  const notifier = await fs.readFile(path.join(root, "scripts", "run-monitors-and-notify.mjs"), "utf8");
  assert.match(notifier, /getWatchlist\("google-pixel-watch-5"\)/);
  assert.match(notifier, /pixelWatch5Report/);
  assert.ok(ALL_WATCHLISTS.some((watchlist) => watchlist.id === "google-pixel-watch-5" && watchlist.label === "Google Pixel Watch 5"));
});

test("publicacao local nao aborta imediatamente em caso de erro do monitor", async () => {
  const script = await fs.readFile(path.join(root, "scripts", "run-local-olx-and-publish.ps1"), "utf8");
  // Verifica se a variável $monitorFailed está definida
  assert.match(script, /\$monitorFailed\s*=\s*\$monitorExit\s*-ne\s*0/);

  // Verifica a ordem das chamadas: git add < git push < throw final do monitor
  assert.match(script, /\$stagePaths\s*=\s*@\(/);
  assert.match(script, /Where-Object \{ Test-Path -LiteralPath/);
  assert.match(script, /git add -- \$stagePaths/);
  const gitAddIdx = script.indexOf("git add -- $stagePaths");
  const gitPushIdx = script.indexOf("git push");
  const throwIdx = script.lastIndexOf("Monitor OLX local falhou");

  assert.ok(gitAddIdx !== -1, "git add não encontrado");
  assert.ok(gitPushIdx !== -1, "git push não encontrado");
  assert.ok(throwIdx !== -1, "throw do monitor não encontrado");

  assert.ok(gitAddIdx < gitPushIdx, "git add deve ocorrer antes do git push");
  assert.ok(gitPushIdx < throwIdx, "git push deve ocorrer antes de lançar erro do monitor");
});
