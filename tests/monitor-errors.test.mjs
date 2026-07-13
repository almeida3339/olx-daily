import test from "node:test";
import assert from "node:assert/strict";
import { classifyMonitorError, retryTransient } from "../scripts/lib/monitor-errors.mjs";

test("classifica captcha, sessao, limite e erro transitorio sem reabrir busca bloqueada", () => {
  assert.equal(classifyMonitorError({ pageState: "challenge", message: "captcha" }).kind, "challenge");
  assert.equal(classifyMonitorError({ pageState: "logged_out", message: "sessao expirada" }).kind, "authentication");
  assert.equal(classifyMonitorError({ pageState: "limited", message: "HTTP 429" }).kind, "rate_limited");
  assert.equal(classifyMonitorError(new Error("net::ERR_NETWORK_IO_SUSPENDED")).retriable, true);
});

test("repete uma unica vez apenas erro transitorio", async () => {
  let attempts = 0;
  const waits = [];
  const value = await retryTransient(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("network error");
    return "ok";
  }, { sleep: async (ms) => waits.push(ms) });
  assert.equal(value, "ok");
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [30_000]);
});
