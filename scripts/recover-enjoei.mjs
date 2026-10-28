// Recuperação local sem envio de notificações. A fila agendada usa --stale-only.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { ENJOEI_RECOVERY_JOBS, staleEnjoeiJobs } from './lib/enjoei-recovery.mjs';
import { LOCAL_WATCHLISTS, resolveWatchlistDataDir } from './lib/watchlists-registry.mjs';
import { writeJsonAtomic } from './lib/monitor-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockFile = path.join(root, 'logs', 'enjoei-recovery.lock');
await fs.mkdir(path.dirname(lockFile), { recursive: true });
let lock;
try { lock = await fs.open(lockFile, 'wx'); }
catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const owner = JSON.parse(await fs.readFile(lockFile, 'utf8'));
  let alive = true;
  try { process.kill(owner.pid, 0); } catch (err) { alive = err.code !== 'ESRCH'; }
  if (alive) { console.log('Recuperação Enjoei já está em execução; nenhum coletor duplicado iniciado.'); process.exit(0); }
  await fs.unlink(lockFile);
  lock = await fs.open(lockFile, 'wx');
}
await lock.writeFile(JSON.stringify({ pid: process.pid }));
try {
const jobs = process.argv.includes('--stale-only') ? await staleEnjoeiJobs(root) : ENJOEI_RECOVERY_JOBS;
const env = { ...process.env };
for (const spec of LOCAL_WATCHLISTS) if (spec.env) env[spec.env] = resolveWatchlistDataDir(root, spec);
console.log(`Recuperação Enjoei: ${jobs.length} grupo(s); sem envio de notificações.`);
const recovery = { started_at: new Date().toISOString(), jobs: [] };
for (const job of jobs) {
  console.log(`${job.script}: ${job.reason ?? 'Recuperação manual'}.`);
  const exit = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts', job.script)], { cwd: root, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (![0, 2, 3].includes(exit)) { console.error(`Falha na recuperação: ${job.script} (exit ${exit}).`); process.exitCode = 1; }
  recovery.jobs.push({ ids: job.ids, exit_code: exit, reason: job.reason ?? 'manual', failed_workflow_id: job.failed_workflow_id ?? null });
}
recovery.completed_at = new Date().toISOString();
await writeJsonAtomic(path.join(root, 'data', 'status', 'enjoei-recovery.json'), recovery, { validate: null });
} finally { await lock.close(); await fs.unlink(lockFile); }
