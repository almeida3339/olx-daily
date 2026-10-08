import path from "node:path";
import { listCommittedRuns, readJsonValidated, writeJsonAtomic } from "./monitor-runtime.mjs";

const MAX_HISTORY = 120;

export async function appendMonitorHistory(dataDir, entry) {
  const filePath = path.join(dataDir, "run-history.json");
  let history = [];
  try {
    const value = await readJsonValidated(filePath);
    history = Array.isArray(value?.runs) ? value.runs : [];
  } catch {}
  const runs = [...history.filter((run) => run.run_id !== entry.run_id), entry]
    .sort(newestFirst)
    .slice(0, MAX_HISTORY);
  const value = { schema_version: 1, updated_at: new Date().toISOString(), runs };
  await writeJsonAtomic(filePath, value, { validate: null });
  return value;
}

export async function readMonitorHistory(dataDir) {
  let history = [];
  try {
    const value = await readJsonValidated(path.join(dataDir, "run-history.json"));
    history = Array.isArray(value?.runs) ? value.runs : [];
  } catch {}
  const recovered = (await listCommittedRuns(dataDir, { limit: MAX_HISTORY })).map(historyFromArtifact);
  const byId = new Map([...history, ...recovered].map((run) => [run.run_id, run]));
  return [...byId.values()].sort(newestFirst).slice(0, MAX_HISTORY);
}

export function historyFromArtifact({ manifest, snapshot }) {
  const completedAt = snapshot.run?.completed_at ?? manifest.committed_at;
  const start = Date.parse(snapshot.run?.started_at ?? snapshot.run?.collection_started_at ?? manifest.metadata?.collection_started_at);
  const end = Date.parse(completedAt);
  return {
    run_id: manifest.run_id, committed_at: manifest.committed_at, completed_at: completedAt,
    outcome: snapshot.run?.partial ? 'partial' : 'success', partial: Boolean(snapshot.run?.partial),
    duration_ms: Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null,
    item_count: snapshot.items.length, metadata: { ...manifest.metadata, in_progress: Boolean(snapshot.run?.in_progress ?? manifest.metadata?.in_progress) },
  };
}

function newestFirst(left, right) {
  const time = (run) => Date.parse(run.completed_at ?? run.committed_at ?? run.started_at ?? '') || 0;
  return time(right) - time(left);
}

export function summarizeMonitorHistory(runs, { sample = 10 } = {}) {
  // Intermediate batches are still in progress, not completed failed runs.
  const recent = runs.filter((run) => !run.metadata?.in_progress).sort(newestFirst).slice(0, sample);
  const partial = recent.filter((run) => run.partial).length;
  const failed = recent.filter((run) => run.outcome === "failed").length;
  const durations = recent.filter((run) => run.duration_ms != null).map((run) => Number(run.duration_ms)).filter((value) => Number.isFinite(value) && value >= 0);
  return {
    sample: recent.length,
    partial,
    failed,
    success_rate: recent.length ? recent.filter((run) => !run.partial && run.outcome !== 'failed').length / recent.length : null,
    median_duration_ms: median(durations),
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
