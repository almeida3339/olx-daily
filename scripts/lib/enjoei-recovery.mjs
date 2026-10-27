import { readLatestValidSnapshot } from './monitor-runtime.mjs';
import { resolveWatchlistDataDir } from './watchlists-registry.mjs';
import { ENJOEI_JAPANESE_JEANS } from './enjoei-japanese-jeans.mjs';

export const ENJOEI_RECOVERY_JOBS = [
  { script: 'monitor-enjoei-tenis.mjs', ids: ['enjoei'] },
  { script: 'monitor-enjoei-notebooks.mjs', ids: ['enjoei-notebooks'] },
  { script: 'monitor-enjoei-zegna.mjs', ids: ['enjoei-zegna'] },
  { script: 'monitor-enjoei-ricardo-almeida.mjs', ids: ['enjoei-ricardo-almeida'] },
  { script: 'monitor-enjoei-jacob-cohen.mjs', ids: ['enjoei-jacob-cohen'] },
  { script: 'monitor-enjoei-brunello-cucinelli.mjs', ids: ['enjoei-brunello-cucinelli'] },
  { script: 'monitor-enjoei-japanese-jeans.mjs', ids: ENJOEI_JAPANESE_JEANS.map(spec => spec.id) },
];

export async function staleEnjoeiJobs(root, { now = Date.now(), maxAgeMs = 36 * 3600_000 } = {}) {
  const selected = await Promise.all(ENJOEI_RECOVERY_JOBS.map(async job => {
    const snapshots = await Promise.all(job.ids.map(id => readLatestValidSnapshot(resolveWatchlistDataDir(root, id))));
    const stale = snapshots.some(({ snapshot }) => {
      const checkedAt = Date.parse(snapshot?.generated_at ?? '');
      return !Number.isFinite(checkedAt) || now - checkedAt > maxAgeMs;
    });
    return stale ? job : null;
  }));
  return selected.filter(Boolean);
}
