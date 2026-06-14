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
  ]) {
    assert.match(script, new RegExp(`data/${folder}`));
  }
});

test("painel e notificacoes incluem Galaxy Buds4 Pro do Mercado Livre", async () => {
  const [dashboard, notifier] = await Promise.all([
    fs.readFile(path.join(root, "scripts", "generate-dashboard.mjs"), "utf8"),
    fs.readFile(path.join(root, "scripts", "run-monitors-and-notify.mjs"), "utf8"),
  ]);
  assert.match(dashboard, /mercadolivre-galaxy-buds4-pro/);
  assert.match(notifier, /mercadolivre-galaxy-buds4-pro/);
});
