import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { commitMonitorRun, readLatestCommittedReport, readLatestValidSnapshot, writeJsonAtomic, writeTextAtomic } from "../scripts/lib/monitor-runtime.mjs";

test("I/O atomico grava snapshot validado e texto", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "monitor-runtime-"));
  const snapshotPath = path.join(root, "snapshot-2026-07-12T12-00-00-000Z.json");
  const reportPath = path.join(root, "report-2026-07-12T12-00-00-000Z.md");
  await writeJsonAtomic(snapshotPath, { schema_version: 2, generated_at: "2026-07-12T12:00:00.000Z", items: [] });
  await writeTextAtomic(reportPath, "# Relatorio\n");
  assert.equal(JSON.parse(await fs.readFile(snapshotPath, "utf8")).schema_version, 2);
  assert.equal(await fs.readFile(reportPath, "utf8"), "# Relatorio\n");
});

test("le o snapshot valido anterior quando o arquivo mais novo esta corrompido", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "monitor-runtime-"));
  await writeJsonAtomic(path.join(root, "snapshot-2026-07-12T12-00-00-000Z.json"), { schema_version: 2, items: [] });
  await fs.writeFile(path.join(root, "snapshot-2026-07-12T13-00-00-000Z.json"), "{invalido", "utf8");
  const result = await readLatestValidSnapshot(root);
  assert.equal(result.file, "snapshot-2026-07-12T12-00-00-000Z.json");
  assert.equal(result.invalid.length, 1);
});

test("promove apenas uma rodada com snapshot e relatorio validados", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "monitor-runtime-"));
  const result = await commitMonitorRun(root, {
    runId: "2026-07-12T12-00-00-000Z",
    snapshot: { schema_version: 2, items: [{ id: "1", url: "https://example.com/1", title: "Item", price_brl: 10, status: "active" }] },
    report: "# Relatorio\n",
  });
  const latest = await readLatestValidSnapshot(root);
  const report = await readLatestCommittedReport(root);
  assert.equal(latest.manifest.run_id, result.manifest.run_id);
  assert.equal(latest.snapshot.items.length, 1);
  assert.equal(report.report, "# Relatorio\n");
});

test("item malformado e separado em quarentena sem invalidar a rodada", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "monitor-runtime-"));
  const result = await commitMonitorRun(root, {
    runId: "2026-07-12T12-00-00-001Z",
    snapshot: { schema_version: 2, items: [{ id: "ok", url: "https://example.com", price_brl: 1 }, { title: "sem chave" }] },
    report: "# Relatorio\n",
  });
  assert.equal(result.snapshot.items.length, 1);
  assert.equal(result.invalidItems.length, 1);
  assert.equal(result.snapshot.run.quarantined_item_count, 1);
});
