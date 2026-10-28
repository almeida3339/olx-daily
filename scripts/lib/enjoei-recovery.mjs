import { readLatestValidSnapshot } from './monitor-runtime.mjs';
import { resolveWatchlistDataDir } from './watchlists-registry.mjs';
import { ENJOEI_JAPANESE_JEANS } from './enjoei-japanese-jeans.mjs';

let cachedCiCheck;
export async function latestEnjoeiWorkflow({ now = Date.now(), fetchFn = fetch } = {}) {
  if (process.env.GITHUB_ACTIONS === 'true') return null;
  if (cachedCiCheck && now - cachedCiCheck.checkedAt < 60_000) return cachedCiCheck.run;
  try {
    const response = await fetchFn('https://api.github.com/repos/almeida3339/olx-daily/actions/workflows/monitor.yml/runs?branch=main&per_page=5', {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'olx-daily-enjoei-recovery' }, signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.workflow_runs)) throw new Error('Resposta sem execuções');
    const run = payload.workflow_runs.filter(run => run.head_branch === 'main')
      .sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null;
    cachedCiCheck = { checkedAt: now, run };
    return run;
  } catch (error) {
    console.warn(`Não foi possível conferir o workflow Enjoei (${error.message}); recuperação por idade permanece disponível.`);
    cachedCiCheck = { checkedAt: now, run: null };
    return null;
  }
}

export const ENJOEI_RECOVERY_JOBS = [
  { script: 'monitor-enjoei-tenis.mjs', ids: ['enjoei'] },
  { script: 'monitor-enjoei-notebooks.mjs', ids: ['enjoei-notebooks'] },
  { script: 'monitor-enjoei-zegna.mjs', ids: ['enjoei-zegna'] },
  { script: 'monitor-enjoei-ricardo-almeida.mjs', ids: ['enjoei-ricardo-almeida'] },
  { script: 'monitor-enjoei-jacob-cohen.mjs', ids: ['enjoei-jacob-cohen'] },
  { script: 'monitor-enjoei-brunello-cucinelli.mjs', ids: ['enjoei-brunello-cucinelli'] },
  { script: 'monitor-enjoei-japanese-jeans.mjs', ids: ENJOEI_JAPANESE_JEANS.map(spec => spec.id) },
];

export async function staleEnjoeiJobs(root, { now = Date.now(), maxAgeMs = 36 * 3600_000, ciRun, fetchFn } = {}) {
  const latest = ciRun === undefined ? await latestEnjoeiWorkflow({ now, fetchFn }) : ciRun;
  // A queued/running CI owns the collection; do not launch a local duplicate.
  if (latest && latest.status !== 'completed') return [];
  const failedAt = latest && ['failure','timed_out','startup_failure'].includes(latest.conclusion)
    ? Date.parse(latest.run_started_at ?? latest.created_at) : NaN;
  const selected = await Promise.all(ENJOEI_RECOVERY_JOBS.map(async job => {
    const snapshots = await Promise.all(job.ids.map(id => readLatestValidSnapshot(resolveWatchlistDataDir(root, id))));
    const stale = snapshots.some(({ snapshot }) => {
      const checkedAt = Date.parse(snapshot?.generated_at ?? '');
      return !Number.isFinite(checkedAt) || now - checkedAt > maxAgeMs;
    });
    const missedRun = Number.isFinite(failedAt) && snapshots.some(({ snapshot }) => {
      const checkedAt = Date.parse(snapshot?.run?.completed_at ?? snapshot?.generated_at ?? '');
      return !Number.isFinite(checkedAt) || checkedAt < failedAt;
    });
    return stale || missedRun ? { ...job, reason: missedRun ? `Falha confirmada no GitHub (execução ${latest.id})` : 'Dados com mais de 36 horas',
      failed_workflow_id: missedRun ? latest.id : null } : null;
  }));
  return selected.filter(Boolean);
}
