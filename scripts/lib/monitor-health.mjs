import path from "node:path";
import { classifyMonitorError } from "./monitor-errors.mjs";
import { readMonitorHistory, summarizeMonitorHistory } from "./monitor-history.mjs";
import { readJsonValidated, readLatestValidSnapshot, timestampFromArtifactName } from "./monitor-runtime.mjs";

const HOUR = 60 * 60 * 1000;

export const monitorHealthSources = [
  ["olx", "OLX Notebooks", 24 * HOUR],
  ["enjoei-notebooks", "Enjoei Notebooks", 24 * HOUR],
  ["enjoei", "Enjoei Tênis", 24 * HOUR],
  ["dockstations", "Dockstations", 24 * HOUR],
  ["fitbit", "Fitbit Air", 24 * HOUR],
  ["lifefactory", "Lifefactory", 24 * HOUR],
  ["tela-galaxybook3", "Tela Book3", 24 * HOUR],
  ["melanger", "Melanger", 24 * HOUR],
  ["galaxy-buds4-pro", "Galaxy Buds4 Pro", 24 * HOUR],
  ["oura-ring5", "Oura Ring 5", 24 * HOUR],
  ["oled-monitores", "Monitores OLED", 24 * HOUR],
  ["mercadolivre-notebooks", "ML Notebooks", 7 * 24 * HOUR],
  ["mercadolivre-galaxy-buds4-pro", "ML Galaxy Buds4 Pro", 7 * 24 * HOUR],
  ["mercadolivre-dockstations", "ML Dockstations", 7 * 24 * HOUR],
  ["mercadolivre-fitbit-air", "ML Fitbit Air", 7 * 24 * HOUR],
  ["mercadolivre-lifefactory", "ML Lifefactory", 7 * 24 * HOUR],
  ["mercadolivre-tela-galaxybook3", "ML Tela Book3", 7 * 24 * HOUR],
  ["mercadolivre-melanger", "ML Melanger", 7 * 24 * HOUR],
  ["mercadolivre-tenis-42", "ML Tênis 42", 7 * 24 * HOUR],
  ["mercadolivre-oled-monitores", "ML Monitores OLED", 7 * 24 * HOUR],
];

export async function buildMonitorHealth(root, { now = new Date() } = {}) {
  const sources = [];
  for (const [id, label, maxAgeMs] of monitorHealthSources) {
    const dataDir = path.join(root, "data", id);
    const result = await readLatestValidSnapshot(dataDir);
    const snapshot = result.snapshot;
    const history = await readMonitorHistory(dataDir);
    const historySummary = summarizeMonitorHistory(history);
    const timestamp = snapshotTimestamp(snapshot, result.file);
    const ageMs = timestamp == null ? null : Math.max(0, now.getTime() - timestamp);
    const errors = asArray(snapshot?.run?.errors ?? snapshot?.run?.failed_terms);
    const classifications = errors.map((error) => classifyMonitorError(typeof error === "string" ? error : error?.error));
    let state = "healthy";
    if (!snapshot) state = "missing";
    else if (classifications.some((item) => ["challenge", "authentication", "rate_limited"].includes(item.kind))) state = "blocked";
    else if (snapshot.run?.partial) state = "partial";
    else if (ageMs != null && ageMs > maxAgeMs) state = "stale";
    else if (historySummary.sample >= 3 && (historySummary.partial + historySummary.failed) >= Math.ceil(historySummary.sample / 2)) state = "degraded";
    sources.push({
      id,
      label,
      state,
      updated_at: timestamp == null ? null : new Date(timestamp).toISOString(),
      age_ms: ageMs,
      invalid_snapshots: result.invalid.length,
      history: historySummary,
      message: healthMessage(state),
    });
  }
  const statusDir = path.join(root, "data", "status");
  const statuses = await Promise.all(["latest-local.json", "latest-ci.json"].map(async (file) => readJsonValidated(path.join(statusDir, file)).catch(() => null)));
  const outbox = statuses.flatMap((status) => asArray(status?.notification_outbox));
  const blocked = outbox.filter((item) => item.status === "blocked").length;
  const retrying = outbox.filter((item) => ["pending", "retry_wait", "sending"].includes(item.status)).length;
  sources.push({
    id: "notifications",
    label: "Notificações",
    state: blocked ? "blocked" : retrying ? "partial" : "healthy",
    updated_at: null,
    age_ms: null,
    invalid_snapshots: 0,
    message: blocked ? `${blocked} entrega(s) bloqueada(s)` : retrying ? `${retrying} entrega(s) aguardando nova tentativa` : "Fila de entrega saudável",
    outbox: outbox.filter((item) => item.status !== "sent").map((item) => ({
      id: item.id,
      channel: item.channel,
      status: item.status,
      attempts: item.attempts,
      next_attempt_at: item.next_attempt_at,
      last_error: item.last_error,
    })),
  });
  return { schema_version: 2, generated_at: now.toISOString(), sources };
}

function healthMessage(state) {
  if (state === "partial") return "Cobertura parcial";
  if (state === "stale") return "Coleta desatualizada";
  if (state === "blocked") return "Login, limite ou desafio exigem atenção";
  if (state === "missing") return "Sem snapshot válido";
  if (state === "degraded") return "Falhas ou cobertura parcial recorrentes";
  return "Saudável";
}

function snapshotTimestamp(snapshot, file) {
  const candidates = [snapshot?.run?.completed_at, snapshot?.run?.started_at, snapshot?.generated_at];
  for (const value of candidates) {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) return timestamp;
  }
  return timestampFromArtifactName(file);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}
