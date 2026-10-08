import path from "node:path";
import { classifyMonitorError } from "./monitor-errors.mjs";
import { MONITOR_LABELS } from "./monitor-labels.mjs";
import { readMonitorHistory, summarizeMonitorHistory } from "./monitor-history.mjs";
import { listCommittedRuns, readJsonValidated, readLatestValidSnapshot, timestampFromArtifactName } from "./monitor-runtime.mjs";
import { mergeCoverageStatus } from "./monitor-coverage.mjs";
import { watchlistHealthDefinitions } from "./watchlists-registry.mjs";

const monitorHealthSourceDefinitions = watchlistHealthDefinitions();

export const monitorHealthSources = monitorHealthSourceDefinitions.map(([id, label, maxAgeMs]) => [id, MONITOR_LABELS[id] ?? label, maxAgeMs]);

export async function buildMonitorHealth(root, { now = new Date() } = {}) {
  const sources = [];
  for (const [id, label, maxAgeMs] of monitorHealthSources) {
    const dataDir = path.join(root, "data", id);
    const result = await readLatestValidSnapshot(dataDir);
    const snapshot = result.snapshot;
    const history = await readMonitorHistory(dataDir);
    const historySummary = summarizeMonitorHistory(history);
    const artifacts = await listCommittedRuns(dataDir, { limit: 120 });
    let coverage = {};
    for (const artifact of artifacts.reverse()) coverage = mergeCoverageStatus(coverage, artifact.snapshot);
    coverage = mergeCoverageStatus(coverage, snapshot ?? {});
    const configured = snapshot?.run?.configured_coverage ?? snapshot?.run?.configured_terms ?? [];
    const marketplaces = coverageHealth(configured, coverage, { now, maxAgeMs, id });
    const timestamp = snapshotTimestamp(snapshot, result.file);
    const ageMs = timestamp == null ? null : Math.max(0, now.getTime() - timestamp);
    const errors = asArray(snapshot?.run?.errors ?? snapshot?.run?.failed_terms);
    const classifications = errors.map((error) => classifyMonitorError(typeof error === "string" ? error : error?.error));
    let state = "healthy";
    if (!snapshot) state = "missing";
    else if (classifications.some((item) => ["challenge", "authentication", "rate_limited"].includes(item.kind))) state = "blocked";
    else if (ageMs != null && ageMs > maxAgeMs) state = "stale";
    else if (snapshot.run?.partial) state = "partial";
    else if (historySummary.sample >= 3 && (historySummary.partial + historySummary.failed) >= Math.ceil(historySummary.sample / 2)) state = "degraded";
    if (marketplaces.length && snapshot) state = worstState(marketplaces.map((source) => source.state));
    if (snapshot?.run?.in_progress && state === 'healthy') state = 'partial';
    sources.push({
      id,
      label,
      state,
      updated_at: timestamp == null ? null : new Date(timestamp).toISOString(),
      age_ms: ageMs,
      invalid_snapshots: result.invalid.length,
      history: historySummary,
      marketplaces,
      message: snapshot?.run?.in_progress ? 'Coleta em andamento; progresso salvo' : marketplaces.length
        ? marketplaces.map((source) => `${source.label}: ${healthMessage(source.state)} (${source.fresh_terms}/${source.total_terms} termos recentes)`).join(' · ')
        : healthMessage(state),
    });
  }
  const statusDir = path.join(root, "data", "status");
  const statuses = await Promise.all(["latest-local.json", "latest-ci.json"].map(async (file) => readJsonValidated(path.join(statusDir, file)).catch(() => null)));
  const outbox = dedupeNotificationOutbox(statuses);
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

function worstState(states) {
  return ['blocked', 'missing', 'stale', 'partial', 'degraded', 'healthy'].find((state) => states.includes(state)) ?? 'healthy';
}

function coverageHealth(configured, coverage, { now, maxAgeMs, id }) {
  const groups = new Map();
  for (const key of configured) {
    const label = key.includes(':') ? key.split(':')[0] : id.startsWith('mercadolivre-') ? 'ML' : id === 'olx' ? 'OLX' : 'Enjoei';
    const terms = groups.get(label) ?? [];
    terms.push(coverage[key] ?? {});
    groups.set(label, terms);
  }
  return [...groups].map(([label, terms]) => {
    const states = terms.map((term) => {
      if (!term.checked_at) return 'partial';
      if (term.state === 'failed' && ['challenge', 'authentication', 'rate_limited'].includes(classifyMonitorError(term.error).kind)) return 'blocked';
      if (now.getTime() - Date.parse(term.checked_at) > maxAgeMs) return 'stale';
      return term.state === 'failed' ? 'partial' : 'healthy';
    });
    return { label, state: worstState(states), total_terms: terms.length, fresh_terms: states.filter((state) => state === 'healthy').length,
      updated_at: terms.map((term) => term.checked_at).filter(Boolean).sort().at(-1) ?? null };
  });
}

// Local e CI podem carregar o mesmo item persistido no outbox. O ID é a chave
// de identidade; em caso de divergência, vence o estado mais recente (ou
// bloqueado, para não esconder uma falha que exige ação).
function dedupeNotificationOutbox(statuses) {
  const byId = new Map();
  for (const status of statuses) {
    for (const item of asArray(status?.notification_outbox)) {
      const key = item?.id ?? `${item?.channel ?? "?"}:${item?.dedupe_key ?? item?.last_error ?? "?"}`;
      const previous = byId.get(key);
      if (!previous || compareNotificationItems(item, previous) > 0) byId.set(key, item);
    }
  }
  return [...byId.values()];
}

function compareNotificationItems(left, right) {
  const leftTs = Date.parse(left?.updated_at ?? left?.created_at ?? "");
  const rightTs = Date.parse(right?.updated_at ?? right?.created_at ?? "");
  if (Number.isFinite(leftTs) && Number.isFinite(rightTs) && leftTs !== rightTs) return leftTs - rightTs;
  if (left?.status === "blocked" && right?.status !== "blocked") return 1;
  if (right?.status === "blocked" && left?.status !== "blocked") return -1;
  return 0;
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
