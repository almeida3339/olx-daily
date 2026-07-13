import test from "node:test";
import assert from "node:assert/strict";
import { claimNotification, enqueueNotification, readyNotificationItems, recoverAbandonedNotifications, settleNotification } from "../scripts/lib/notification-outbox.mjs";

test("outbox deduplica a mesma notificacao e remove quando entregue", () => {
  const now = new Date("2026-07-12T12:00:00.000Z");
  const entry = { channel: "email", payload: { subject: "teste", body: "conteudo" } };
  let outbox = enqueueNotification([], entry, now);
  outbox = enqueueNotification(outbox, entry, now);
  assert.equal(outbox.length, 1);
  assert.equal(readyNotificationItems(outbox, now).length, 1);
  outbox = settleNotification(outbox, outbox[0].id, { ok: true }, now);
  assert.equal(outbox.length, 0);
});

test("outbox agenda retry transitorio e bloqueia credencial invalida", () => {
  const now = new Date("2026-07-12T12:00:00.000Z");
  let outbox = enqueueNotification([], { channel: "whatsapp", payload: { message: "oi" } }, now);
  outbox = settleNotification(outbox, outbox[0].id, { ok: false, error: new Error("network error") }, now);
  assert.equal(outbox[0].status, "retry_wait");
  outbox = settleNotification(outbox, outbox[0].id, { ok: false, error: new Error("sessao expirada") }, now);
  assert.equal(outbox[0].status, "blocked");
});

test("tentativa fica marcada como sending e e recuperada depois de abandono", () => {
  const now = new Date("2026-07-12T12:00:00.000Z");
  let outbox = enqueueNotification([], { channel: "email", payload: { subject: "oi", body: "teste" } }, now);
  outbox = claimNotification(outbox, outbox[0].id, now);
  assert.equal(outbox[0].status, "sending");
  assert.equal(readyNotificationItems(outbox, now).length, 0);
  outbox = recoverAbandonedNotifications(outbox, new Date("2026-07-12T12:06:00.000Z"));
  assert.equal(outbox[0].status, "retry_wait");
  assert.equal(readyNotificationItems(outbox, new Date("2026-07-12T12:06:00.000Z")).length, 1);
});
