import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildMonitorHealth } from "../scripts/lib/monitor-health.mjs";
import { writeJsonAtomic } from "../scripts/lib/monitor-runtime.mjs";

test("saude marca coleta parcial e Mercado Livre desatualizado", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "monitor-health-"));
  const data = path.join(root, "data");
  await fs.mkdir(path.join(data, "enjoei-notebooks"), { recursive: true });
  await fs.mkdir(path.join(data, "mercadolivre-notebooks"), { recursive: true });
  await writeJsonAtomic(path.join(data, "enjoei-notebooks", "snapshot-2026-07-12T12-00-00-000Z.json"), {
    schema_version: 2, items: [], run: { partial: true, completed_at: "2026-07-12T12:00:00.000Z" },
  });
  await writeJsonAtomic(path.join(data, "mercadolivre-notebooks", "snapshot-2026-07-01T12-00-00-000Z.json"), {
    schema_version: 2, items: [], run: { partial: false, completed_at: "2026-07-01T12:00:00.000Z" },
  });
  const health = await buildMonitorHealth(root, { now: new Date("2026-07-12T12:00:00.000Z") });
  assert.equal(health.sources.find((source) => source.id === "enjoei-notebooks").state, "partial");
  assert.equal(health.sources.find((source) => source.id === "mercadolivre-notebooks").state, "stale");
});
