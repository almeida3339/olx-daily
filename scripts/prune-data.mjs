import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MONITOR_ARTIFACT_RETENTION_RUNS, pruneMonitorArtifacts } from "./lib/monitor-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

export async function pruneData({ dataRoot = path.join(root, "data"), keepRuns = Number(option("--keep-runs") ?? process.env.MONITOR_ARTIFACT_RETENTION_RUNS ?? DEFAULT_MONITOR_ARTIFACT_RETENTION_RUNS) } = {}) {
  const entries = await fs.readdir(dataRoot, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory() && entry.name !== "status");
  for (const entry of dirs) {
    await pruneMonitorArtifacts(path.join(dataRoot, entry.name), { keepRuns });
  }
  return dirs.map((entry) => entry.name);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  pruneData()
    .then((dirs) => console.log(`Retenção aplicada a ${dirs.length} diretório(s); ${Number(option("--keep-runs") ?? process.env.MONITOR_ARTIFACT_RETENTION_RUNS ?? DEFAULT_MONITOR_ARTIFACT_RETENTION_RUNS)} rodada(s) preservadas por fonte.`))
    .catch((error) => {
      console.error(`Falha ao aplicar retenção: ${error.message}`);
      process.exitCode = 1;
    });
}
