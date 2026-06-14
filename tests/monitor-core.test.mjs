import test from "node:test";
import assert from "node:assert/strict";
import {
  MONITOR_SNAPSHOT_SCHEMA_VERSION,
  buildMonitorChanges,
  mergeMonitorSnapshot,
  normalizeMonitorCode,
  normalizeMonitorText,
} from "../scripts/lib/monitor-core.mjs";

test("normalizacao compartilhada trata acentos e separadores", () => {
  assert.equal(normalizeMonitorText("Condição ÚSADO"), "condicao usado");
  assert.equal(normalizeMonitorCode("SD25-TB4"), "sd25tb4");
});

test("snapshot unificado inclui schema, filtros e metadados de cobertura", () => {
  const snapshot = mergeMonitorSnapshot({
    previousSnapshot: null,
    collected: [{ id: "1", title: "Produto", price_brl: 100, term: "modelo", status: "active" }],
    now: new Date("2026-06-14T12:00:00Z"),
    run: { id: "teste", label: "Teste" },
    filters: { price_brl: { min: 0, max: 500 } },
    configuredCoverage: ["OLX:modelo"],
    scheduledCoverage: ["OLX:modelo"],
    successfulCoverage: ["OLX:modelo"],
    itemCoverage: () => ["OLX:modelo"],
  });
  assert.equal(snapshot.schema_version, MONITOR_SNAPSHOT_SCHEMA_VERSION);
  assert.equal(snapshot.generated_at, "2026-06-14T12:00:00.000Z");
  assert.equal(snapshot.run.date, "2026-06-14");
  assert.deepEqual(snapshot.filters.price_brl, { min: 0, max: 500 });
  assert.deepEqual(snapshot.run.successful_coverage, ["OLX:modelo"]);
  assert.equal(snapshot.items[0].first_seen, "2026-06-14");
  assert.equal(snapshot.items[0].price_history.length, 1);
});

test("snapshot legado sem schema continua sendo aceito como anterior", () => {
  const previousSnapshot = {
    run: { date: "2026-06-13" },
    items: [{
      id: "1",
      title: "Produto",
      price_brl: 100,
      source: "OLX",
      term: "modelo",
      status: "active",
      first_seen: "2026-06-13",
      last_seen: "2026-06-13",
    }],
  };
  const snapshot = mergeMonitorSnapshot({
    previousSnapshot,
    collected: [{ id: "1", title: "Produto", price_brl: 90, source: "OLX", term: "modelo" }],
    now: new Date("2026-06-14T12:00:00Z"),
    configuredCoverage: ["OLX:modelo"],
    scheduledCoverage: ["OLX:modelo"],
    successfulCoverage: ["OLX:modelo"],
  });
  assert.equal(snapshot.items[0].first_seen, "2026-06-13");
  assert.equal(snapshot.items[0].price_brl, 90);
  assert.equal(snapshot.items[0].price_history.length, 1);
});

test("mudancas compartilhadas detectam novos e alteracoes de preco", () => {
  const changes = buildMonitorChanges(
    { items: [{ id: "1", price_brl: 100, status: "active" }] },
    { items: [
      { id: "1", price_brl: 90, status: "active" },
      { id: "2", price_brl: 80, status: "active" },
    ] },
  );
  assert.equal(changes.newItems.length, 1);
  assert.equal(changes.priceChanges.length, 1);
  assert.equal(changes.priceChanges[0].previous_price_brl, 100);
});

test("item de termo removido vira out_of_scope sem alterar last_seen", () => {
  const snapshot = mergeMonitorSnapshot({
    previousSnapshot: {
      items: [{
        id: "antigo",
        term: "modelo-removido",
        price_brl: 100,
        status: "active",
        first_seen: "2026-06-10",
        last_seen: "2026-06-13",
      }],
    },
    collected: [],
    now: new Date("2026-06-14T12:00:00Z"),
    configuredCoverage: ["modelo-atual"],
    scheduledCoverage: ["modelo-atual"],
    successfulCoverage: ["modelo-atual"],
  });
  assert.equal(snapshot.items[0].status, "out_of_scope");
  assert.equal(snapshot.items[0].last_seen, "2026-06-13");
  assert.equal(snapshot.items[0].out_of_scope_at, "2026-06-14T12:00:00.000Z");
});

test("item out_of_scope volta a active quando o termo retorna", () => {
  const snapshot = mergeMonitorSnapshot({
    previousSnapshot: {
      items: [{
        id: "retorno",
        term: "modelo",
        price_brl: 100,
        status: "out_of_scope",
        out_of_scope_at: "2026-06-13T12:00:00Z",
      }],
    },
    collected: [{ id: "retorno", term: "modelo", price_brl: 100 }],
    now: new Date("2026-06-14T12:00:00Z"),
    configuredCoverage: ["modelo"],
    scheduledCoverage: ["modelo"],
    successfulCoverage: ["modelo"],
  });
  assert.equal(snapshot.items[0].status, "active");
  assert.equal(snapshot.items[0].out_of_scope_at, null);
});
