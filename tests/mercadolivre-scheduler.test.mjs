import test from "node:test";
import assert from "node:assert/strict";
import { createMercadoLivreSchedule, planMercadoLivreTerms, recordMercadoLivreRun } from "../scripts/lib/mercadolivre-scheduler.mjs";

test("planejador limita bootstrap e alterna os termos de uma watchlist", () => {
  let schedule = createMercadoLivreSchedule();
  const terms = ["a", "b", "c"];
  const first = planMercadoLivreTerms(schedule, { watchlistId: "x", terms, maxTerms: 2, now: new Date("2026-07-12T12:00:00Z") });
  assert.deepEqual(first.terms, ["a", "b"]);
  schedule = recordMercadoLivreRun(schedule, {
    watchlistId: "x", scheduledTerms: first.terms,
    configuredTerms: terms,
    snapshot: { run: { successful_terms: ["a", "b"], failed_terms: [] }, items: [] },
    now: new Date("2026-07-12T12:00:00Z"),
  });
  const second = planMercadoLivreTerms(schedule, { watchlistId: "x", terms, maxTerms: 2, now: new Date("2026-07-12T12:01:00Z") });
  assert.deepEqual(second.terms, ["c"]);
});

test("challenge ativa pausa persistente ate execucao forcada", () => {
  let schedule = createMercadoLivreSchedule();
  schedule = recordMercadoLivreRun(schedule, {
    watchlistId: "x", scheduledTerms: ["a"],
    snapshot: { run: { successful_terms: [], failed_terms: [{ term: "a", error: "captcha challenge", kind: "challenge" }] }, items: [] },
    now: new Date("2026-07-12T12:00:00Z"),
  });
  const blocked = planMercadoLivreTerms(schedule, { watchlistId: "x", terms: ["a"], now: new Date("2026-07-12T13:00:00Z") });
  assert.equal(blocked.reason, "cooldown");
  const forced = planMercadoLivreTerms(schedule, { watchlistId: "x", terms: ["a"], force: true, now: new Date("2026-07-12T13:00:00Z") });
  assert.deepEqual(forced.terms, ["a"]);
});
