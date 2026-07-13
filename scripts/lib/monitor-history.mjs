import path from "node:path";
import { readJsonValidated, writeJsonAtomic } from "./monitor-runtime.mjs";

const MAX_HISTORY = 120;

export async function appendMonitorHistory(dataDir, entry) {
  const filePath = path.join(dataDir, "run-history.json");
  let history = [];
  try {
    const value = await readJsonValidated(filePath);
    history = Array.isArray(value?.runs) ? value.runs : [];
  } catch {}
  const runs = [...history.filter((run) => run.run_id !== entry.run_id), entry]
    .sort((left, right) => String(right.completed_at).localeCompare(String(left.completed_at)))
    .slice(0, MAX_HISTORY);
  const value = { schema_version: 1, updated_at: new Date().toISOString(), runs };
  await writeJsonAtomic(filePath, value, { validate: null });
  return value;
}

export async function readMonitorHistory(dataDir) {
  try {
    const value = await readJsonValidated(path.join(dataDir, "run-history.json"));
    return Array.isArray(value?.runs) ? value.runs : [];
  } catch {
    return [];
  }
}

export function summarizeMonitorHistory(runs, { sample = 10 } = {}) {
  const recent = runs.slice(0, sample);
  const partial = recent.filter((run) => run.partial).length;
  const failed = recent.filter((run) => run.outcome === "failed").length;
  const durations = recent.map((run) => Number(run.duration_ms)).filter(Number.isFinite);
  return {
    sample: recent.length,
    partial,
    failed,
    success_rate: recent.length ? (recent.length - partial - failed) / recent.length : null,
    median_duration_ms: median(durations),
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
