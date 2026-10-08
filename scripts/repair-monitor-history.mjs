import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_WATCHLISTS } from './lib/watchlists-registry.mjs';
import { readMonitorHistory } from './lib/monitor-history.mjs';
import { writeJsonAtomic } from './lib/monitor-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const source of ALL_WATCHLISTS) {
  const dataDir = path.join(root, 'data', source.repoFolder);
  const runs = await readMonitorHistory(dataDir);
  if (!runs.length) continue;
  await writeJsonAtomic(path.join(dataDir, 'run-history.json'), { schema_version: 1, updated_at: new Date().toISOString(), runs }, { validate: null });
  console.log(`${source.label}: ${runs.length} registros recuperados e ordenados.`);
}
