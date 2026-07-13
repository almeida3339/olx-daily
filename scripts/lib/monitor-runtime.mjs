import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const MONITOR_RUN_MANIFEST_SCHEMA_VERSION = 1;

export async function writeTextAtomic(filePath, text) {
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.writeFile(tempPath, text, "utf8");
    await fs.rename(tempPath, filePath);
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}

// Mantem a leitura de snapshots antigos permissiva. A gravacao de uma rodada
// nova usa validateStrictMonitorSnapshot depois de separar itens ruins.
export function validateMonitorSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("snapshot precisa ser um objeto");
  }
  if (!Array.isArray(snapshot.items)) {
    throw new Error("snapshot.items precisa ser uma lista");
  }
  if (snapshot.schema_version != null && (!Number.isInteger(snapshot.schema_version) || snapshot.schema_version < 1)) {
    throw new Error("schema_version invalido");
  }
  if (snapshot.run != null && (typeof snapshot.run !== "object" || Array.isArray(snapshot.run))) {
    throw new Error("snapshot.run invalido");
  }
  if (snapshot.items.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error("snapshot.items contem item invalido");
  }
  return snapshot;
}

export function validateMonitorItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("item precisa ser um objeto");
  if (!hasText(item.id) && !hasText(item.url)) throw new Error("item sem id ou url");
  if (item.url != null) {
    try {
      const url = new URL(item.url);
      if (!/^https?:$/.test(url.protocol)) throw new Error("protocolo invalido");
    } catch {
      throw new Error("url invalida");
    }
  }
  if (item.title != null && typeof item.title !== "string") throw new Error("titulo invalido");
  if (item.price_brl != null && (!Number.isFinite(Number(item.price_brl)) || Number(item.price_brl) < 0)) {
    throw new Error("preco invalido");
  }
  if (item.status != null && !["active", "not_seen", "out_of_scope"].includes(item.status)) {
    throw new Error("status invalido");
  }
  return item;
}

export function validateStrictMonitorSnapshot(snapshot) {
  validateMonitorSnapshot(snapshot);
  snapshot.items.forEach(validateMonitorItem);
  return snapshot;
}

export function normalizeMonitorSnapshot(snapshot) {
  validateMonitorSnapshot(snapshot);
  return {
    ...snapshot,
    schema_version: snapshot.schema_version ?? 2,
    run: snapshot.run ?? {},
    items: snapshot.items,
  };
}

export function quarantineInvalidItems(snapshot) {
  const normalized = normalizeMonitorSnapshot(snapshot);
  const valid = [];
  const invalid = [];
  for (let index = 0; index < normalized.items.length; index += 1) {
    const item = normalized.items[index];
    try {
      validateMonitorItem(item);
      valid.push(item);
    } catch (error) {
      invalid.push({ index, reason: error.message, item });
    }
  }
  const run = {
    ...normalized.run,
    partial: Boolean(normalized.run?.partial) || invalid.length > 0,
    quarantined_item_count: invalid.length,
  };
  return { snapshot: { ...normalized, run, items: valid }, invalid };
}

export async function writeJsonAtomic(filePath, value, { validate = validateMonitorSnapshot } = {}) {
  if (validate) validate(value);
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJsonValidated(filePath, { validate = null } = {}) {
  const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  return validate ? validate(parsed) : parsed;
}

// Grava uma rodada inteira fora da linha de leitura e so publica o ponteiro
// latest-run.json quando snapshot, relatorio e manifesto ja passaram por validacao.
export async function commitMonitorRun(dataDir, { runId, snapshot, report, metadata = {} }) {
  if (!hasText(runId)) throw new Error("runId obrigatorio");
  if (typeof report !== "string" || !report.trim()) throw new Error("relatorio vazio");
  const prepared = quarantineInvalidItems(snapshot);
  validateStrictMonitorSnapshot(prepared.snapshot);

  const runDir = path.join(dataDir, "runs", runId);
  const snapshotPath = path.join(runDir, "snapshot.json");
  const reportPath = path.join(runDir, "report.md");
  const quarantinePath = path.join(dataDir, "quarantine", `${runId}.json`);
  await writeJsonAtomic(snapshotPath, prepared.snapshot, { validate: validateStrictMonitorSnapshot });
  await writeTextAtomic(reportPath, report);
  if (prepared.invalid.length) {
    await writeJsonAtomic(quarantinePath, {
      schema_version: 1,
      run_id: runId,
      created_at: new Date().toISOString(),
      items: prepared.invalid,
    }, { validate: null });
  }

  const manifest = {
    schema_version: MONITOR_RUN_MANIFEST_SCHEMA_VERSION,
    run_id: runId,
    committed_at: new Date().toISOString(),
    snapshot: relativeArtifact(dataDir, snapshotPath),
    report: relativeArtifact(dataDir, reportPath),
    quarantine: prepared.invalid.length ? relativeArtifact(dataDir, quarantinePath) : null,
    checksums: {
      snapshot_sha256: sha256(JSON.stringify(prepared.snapshot)),
      report_sha256: sha256(report),
    },
    metadata: {
      ...metadata,
      quarantined_item_count: prepared.invalid.length,
    },
  };
  const manifestPath = path.join(runDir, "manifest.json");
  await writeJsonAtomic(manifestPath, manifest, { validate: null });
  await validateRunManifest(dataDir, manifest);

  // Compatibilidade com os relatorios ja publicados e com links antigos. Esses
  // arquivos nao sao a fonte de verdade para leitores novos; latest-run.json e.
  const legacySnapshotPath = path.join(dataDir, `snapshot-${runId}.json`);
  const legacyReportPath = path.join(dataDir, `report-${runId}.md`);
  await writeJsonAtomic(legacySnapshotPath, prepared.snapshot, { validate: validateStrictMonitorSnapshot });
  await writeTextAtomic(legacyReportPath, report);

  await writeJsonAtomic(path.join(dataDir, "latest-run.json"), manifest, { validate: null });
  const { appendMonitorHistory } = await import("./monitor-history.mjs");
  const startedAt = Date.parse(prepared.snapshot.run?.started_at ?? "");
  const completedAt = Date.parse(prepared.snapshot.run?.completed_at ?? manifest.committed_at);
  await appendMonitorHistory(dataDir, {
    run_id: runId,
    committed_at: manifest.committed_at,
    outcome: prepared.snapshot.run?.partial ? "partial" : "success",
    partial: Boolean(prepared.snapshot.run?.partial),
    duration_ms: Number.isFinite(startedAt) && Number.isFinite(completedAt) ? Math.max(0, completedAt - startedAt) : null,
    item_count: prepared.snapshot.items.length,
    quarantined_item_count: prepared.invalid.length,
    metadata: manifest.metadata,
  });
  return {
    snapshot: prepared.snapshot,
    invalidItems: prepared.invalid,
    manifest,
    manifestPath,
    snapshotPath,
    reportPath,
    legacySnapshotPath,
    legacyReportPath,
  };
}

export async function readLatestCommittedRun(dataDir) {
  const pointerPath = path.join(dataDir, "latest-run.json");
  try {
    const manifest = await readJsonValidated(pointerPath, { validate: validateRunManifestShape });
    const value = await validateRunManifest(dataDir, manifest);
    return { ...value, pointerPath, invalid: [] };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return { manifest: null, snapshot: null, report: null, invalid: [{ file: "latest-run.json", error: error.message }] };
  }
}

export async function readLatestValidSnapshot(dir) {
  const committed = await readLatestCommittedRun(dir);
  if (committed?.snapshot) {
    return {
      snapshot: committed.snapshot,
      file: committed.manifest.snapshot,
      invalid: committed.invalid,
      manifest: committed.manifest,
    };
  }
  const entries = await fs.readdir(dir).catch(() => []);
  const files = entries
    .filter((name) => name.startsWith("snapshot-") && name.endsWith(".json"))
    .sort()
    .reverse();
  const invalid = [...(committed?.invalid ?? [])];
  for (const file of files) {
    try {
      const snapshot = await readJsonValidated(path.join(dir, file), { validate: validateMonitorSnapshot });
      return { snapshot: normalizeMonitorSnapshot(snapshot), file, invalid, manifest: null };
    } catch (error) {
      invalid.push({ file, error: error.message });
    }
  }
  return { snapshot: null, file: null, invalid, manifest: null };
}

export async function readLatestCommittedReport(dataDir) {
  const committed = await readLatestCommittedRun(dataDir);
  if (committed?.report != null) return { report: committed.report, file: committed.manifest.report, manifest: committed.manifest };
  return null;
}

export async function listCommittedRuns(dataDir, { limit = 100 } = {}) {
  const runsDir = path.join(dataDir, "runs");
  const names = (await fs.readdir(runsDir).catch(() => []))
    .sort()
    .reverse()
    .slice(0, limit);
  const out = [];
  for (const name of names) {
    try {
      const manifest = await readJsonValidated(path.join(runsDir, name, "manifest.json"), { validate: validateRunManifestShape });
      const run = await validateRunManifest(dataDir, manifest);
      out.push(run);
    } catch {
      // Uma rodada incompleta nunca entra no historico consumido pelo painel.
    }
  }
  return out;
}

export function timestampFromArtifactName(fileName) {
  const match = String(fileName ?? "").match(/(?:snapshot|report)-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, ms] = match;
  const timestamp = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}Z`);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function validateRunManifestShape(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("manifesto invalido");
  if (manifest.schema_version !== MONITOR_RUN_MANIFEST_SCHEMA_VERSION) throw new Error("versao de manifesto invalida");
  if (!hasText(manifest.run_id) || !hasText(manifest.snapshot) || !hasText(manifest.report)) throw new Error("manifesto incompleto");
  return manifest;
}

async function validateRunManifest(dataDir, manifest) {
  validateRunManifestShape(manifest);
  const snapshotPath = artifactPath(dataDir, manifest.snapshot);
  const reportPath = artifactPath(dataDir, manifest.report);
  const [snapshot, report] = await Promise.all([
    readJsonValidated(snapshotPath, { validate: validateStrictMonitorSnapshot }),
    fs.readFile(reportPath, "utf8"),
  ]);
  if (!report.trim()) throw new Error("relatorio do manifesto vazio");
  if (manifest.checksums?.snapshot_sha256 && manifest.checksums.snapshot_sha256 !== sha256(JSON.stringify(snapshot))) {
    throw new Error("checksum do snapshot diverge");
  }
  if (manifest.checksums?.report_sha256 && manifest.checksums.report_sha256 !== sha256(report)) {
    throw new Error("checksum do relatorio diverge");
  }
  return { manifest, snapshot, report, snapshotPath, reportPath };
}

function relativeArtifact(dataDir, filePath) {
  return path.relative(dataDir, filePath).replaceAll("\\", "/");
}

function artifactPath(dataDir, relativePath) {
  const resolved = path.resolve(dataDir, relativePath);
  const root = path.resolve(dataDir) + path.sep;
  if (resolved !== path.resolve(dataDir) && !resolved.startsWith(root)) throw new Error("artefato fora do diretorio da fonte");
  return resolved;
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
