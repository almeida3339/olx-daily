import test from "node:test";
import assert from "node:assert/strict";
import { buildLocalTriggerCommands, classifyNotificationError, groupPendingNotifications } from "../scripts/generate-dashboard.mjs";

test("comandos com raiz explícita usam caminhos absolutos e independem do diretorio atual", () => {
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

test("comandos públicos não expõem o caminho absoluto do usuário", () => {
  const commands = buildLocalTriggerCommands(null);
  assert.ok(Object.values(commands).every((command) => command.includes("$HOME")));
  assert.ok(Object.values(commands).every((command) => !command.includes("C:\\Users\\")));
});

test("classifica respostas 535 do Gmail sem depender do identificador variável", () => {
  const first = classifyNotificationError("Invalid login: 535-5.7.8 Username and Password not accepted ... 6a1803df - gsmtp");
  const second = classifyNotificationError("Invalid login: 535 5.7.8 Username and Password not accepted ... 5a478bee - gsmtp");

  assert.equal(first.code, "smtp-auth");
  assert.equal(second.code, first.code);
  assert.equal(first.label, "credencial SMTP rejeitada");
});

test("agrupa notificações por classe sem exibir cada stack trace", () => {
  const groups = groupPendingNotifications([
    { channel: "email", status: "blocked", attempts: 1, last_error: "535-5.7.8 Username and Password not accepted ... aaa" },
    { channel: "email", status: "blocked", attempts: 3, last_error: "535-5.7.8 Username and Password not accepted ... bbb" },
    { channel: "email", status: "blocked", attempts: 1, last_error: "getaddrinfo ENOTFOUND smtp.gmail.com" },
    { channel: "whatsapp", status: "blocked", attempts: 1, last_error: "fetch failed" },
  ]);

  assert.equal(groups.length, 3);
  assert.equal(groups[0].error_code, "smtp-auth");
  assert.equal(groups.find((item) => item.error_code === "smtp-auth").count, 2);
  assert.equal(groups.find((item) => item.error_code === "smtp-auth").attempts, 3);
  assert.equal(groups.find((item) => item.error_code === "network" && item.channel === "email").count, 1);
});
