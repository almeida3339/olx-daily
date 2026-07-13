import test from "node:test";
import assert from "node:assert/strict";
import { buildLocalTriggerCommands } from "../scripts/generate-dashboard.mjs";

test("comandos do painel usam caminhos absolutos e independem do diretorio atual", () => {
  const commands = buildLocalTriggerCommands("C:\\Monitor Local\\olx-daily");

  assert.equal(
    commands.olx,
    "node 'C:\\Monitor Local\\olx-daily\\scripts\\run-monitors-and-notify.mjs' --only-olx",
  );
  assert.equal(
    commands.mercadoLivre,
    "& 'C:\\Monitor Local\\olx-daily\\scripts\\run-mercadolivre-and-publish.ps1'",
  );
  assert.equal(
    commands.notificacoes,
    "node 'C:\\Monitor Local\\olx-daily\\scripts\\manage-notification-outbox.mjs'",
  );
  assert.ok(!Object.values(commands).some((command) => command.startsWith("cd ")));
});
