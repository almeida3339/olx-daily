// Reconcile saved status from its own recorded facts. Never renew collection times or send alerts.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectionOutcome, reconcileRecordedHealthErrors, buildCollectionSummary } from './lib/collection-summary.mjs';
import { writeJsonAtomic, readLatestValidSnapshot } from './lib/monitor-runtime.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const environment of ['ci','local']) {
  const file = path.join(root, 'data/status', `latest-${environment}.json`);
  const status = JSON.parse(await fs.readFile(file,'utf8'));
  const round = status.round_summary;
  if (!round?.sources?.length || !status.monitoring) continue;
  const oldMonitoring = JSON.stringify(status.monitoring);
  const oldSources = JSON.stringify(round.sources);
  const olxSource = round.sources.find(source => source.id === 'olx');
  if (olxSource?.summary) {
    const {snapshot} = await readLatestValidSnapshot(path.join(root,'data/olx'));
    if (snapshot && Date.parse(snapshot.run.completed_at) === Date.parse(olxSource.summary.collected_at)) {
      const scopes = buildCollectionSummary(snapshot).coverage.price_scopes;
      if (scopes) olxSource.summary.coverage.price_scopes = scopes;
    }
  }
  status.monitoring.errors = reconcileRecordedHealthErrors(round,status.monitoring.errors);
  const existing = status.monitoring.outcomes ?? [];
  const failures = [...new Map(existing.filter(outcome => ['failed','blocked'].includes(outcome.status)).map(outcome => [outcome.source,outcome])).values()];
  const outcomes = [...failures,
    ...round.sources.filter(source => source.summary && !failures.some(outcome => outcome.source === source.id)).map(collectionOutcome)];
  status.monitoring = { ...status.monitoring,
    partial: Boolean(status.monitoring.errors?.length) || outcomes.some(outcome => outcome.status !== 'success'),
    status: outcomes.some(outcome => outcome.status === 'blocked') ? 'blocked'
      : outcomes.some(outcome => outcome.status === 'failed') || status.monitoring.errors?.length ? 'failed'
      : outcomes.some(outcome => outcome.status === 'partial') ? 'partial'
      : outcomes.some(outcome => outcome.status === 'deferred') ? 'deferred' : 'success',
    outcomes, warnings: outcomes.filter(outcome => ['partial','deferred'].includes(outcome.status))
      .map(outcome => ({source:outcome.source,status:outcome.status,reasons:outcome.reasons ?? []})) };
  if (JSON.stringify(status.monitoring) === oldMonitoring && JSON.stringify(round.sources) === oldSources) continue;
  round.execution = status.monitoring.errors.length || outcomes.some(outcome => ['failed','blocked'].includes(outcome.status)) ? 'failed' : 'success';
  round.revised_at = new Date().toISOString();
  await writeJsonAtomic(file,status,{validate:null});
  console.log(`${environment}: resumo reconciliado; coleta e entrega originais preservadas.`);
}
