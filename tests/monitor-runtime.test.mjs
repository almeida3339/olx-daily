import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { commitMonitorRun, pruneMonitorArtifacts, readLatestCommittedReport, readLatestValidSnapshot, sanitizeArtifactText, writeJsonAtomic, writeTextAtomic } from "../scripts/lib/monitor-runtime.mjs";

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

test("artefatos publicados não preservam caminhos locais do Chrome", () => {
  const value = sanitizeArtifactText("C:\\Users\\docra\\Downloads\\olx-daily\\.chrome-olx-profile --user-data-dir=C:\\Users\\docra\\perfil");
  assert.doesNotMatch(value, /C:\\Users\\docra/);
  assert.match(value, /redacted-local-path/);
  assert.match(value, /--user-data-dir=\[redacted\]/);
});

test("retencao remove artefatos antigos sem tocar no ponteiro atual", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "monitor-runtime-retention-"));
  for (const runId of ["2026-07-12T12-00-00-000Z", "2026-07-13T12-00-00-000Z", "2026-07-14T12-00-00-000Z"]) {
    await commitMonitorRun(root, {
      runId,
      snapshot: { schema_version: 2, items: [{ id: runId, url: `https://example.com/${runId}`, status: "active" }] },
      report: `# ${runId}\n`,
    });
  }
  await pruneMonitorArtifacts(root, { keepRuns: 2 });
  await assert.rejects(fs.stat(path.join(root, "runs", "2026-07-12T12-00-00-000Z")));
  await assert.rejects(fs.stat(path.join(root, "snapshot-2026-07-12T12-00-00-000Z.json")));
  assert.equal((await readLatestValidSnapshot(root)).manifest.run_id, "2026-07-14T12-00-00-000Z");
});
