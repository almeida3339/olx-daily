import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("publicacao local inclui todas as pastas de producao do Mercado Livre", async () => {
  const script = await fs.readFile(path.join(root, "scripts", "run-local-olx-and-publish.ps1"), "utf8");
  for (const folder of [
    "mercadolivre-notebooks",
    "mercadolivre-galaxy-buds4-pro",
    "mercadolivre-dockstations",
    "mercadolivre-fitbit-air",
    "mercadolivre-lifefactory",
    "mercadolivre-tela-galaxybook3",
    "mercadolivre-melanger",
    "mercadolivre-tenis-42",
    "mercadolivre-oled-monitores",
  ]) {
    assert.match(script, new RegExp(`data/${folder}`));
  }
});

test("publicacao dedicada do Mercado Livre inclui Monitores OLED e propaga falha da coleta", async () => {
  const script = await fs.readFile(path.join(root, "scripts", "run-mercadolivre-and-publish.ps1"), "utf8");
  assert.match(script, /data\/mercadolivre-oled-monitores/);
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
  assert.match(dashboard, /mercadolivre-galaxy-buds4-pro/);
  assert.match(notifier, /mercadolivre-galaxy-buds4-pro/);
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

test("orquestrador inclui Monitores OLED nos achados notificáveis", async () => {
  const notifier = await fs.readFile(path.join(root, "scripts", "run-monitors-and-notify.mjs"), "utf8");
  assert.match(notifier, /OLED_MONITORES_DIR/);
  assert.match(notifier, /oledMonitoresReport/);
  assert.match(notifier, /label: "Monitores OLED"/);
});

test("publicacao local nao aborta imediatamente em caso de erro do monitor", async () => {
  const script = await fs.readFile(path.join(root, "scripts", "run-local-olx-and-publish.ps1"), "utf8");
  // Verifica se a variável $monitorFailed está definida
  assert.match(script, /\$monitorFailed\s*=\s*\$monitorExit\s*-ne\s*0/);

  // Verifica a ordem das chamadas: git add < git push < throw final do monitor
  const gitAddIdx = script.indexOf("git add data/");
  const gitPushIdx = script.indexOf("git push");
  const throwIdx = script.lastIndexOf("Monitor OLX local falhou");

  assert.ok(gitAddIdx !== -1, "git add não encontrado");
  assert.ok(gitPushIdx !== -1, "git push não encontrado");
  assert.ok(throwIdx !== -1, "throw do monitor não encontrado");

  assert.ok(gitAddIdx < gitPushIdx, "git add deve ocorrer antes do git push");
  assert.ok(gitPushIdx < throwIdx, "git push deve ocorrer antes de lançar erro do monitor");
});
