import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CPU_TERMS } from './lib/cpu-terms.mjs';
import { NOTEBOOK_POLICY_VERSION, assessNotebook, isEligibleNotebook } from './lib/notebook-policy.mjs';
import { revalidateSavedOlxItem, isValidatedOlxItem } from './lib/olx-notebook-quality.mjs';
import { notebookOpportunity } from './lib/notebook-search-plan.mjs';
import { readLatestValidSnapshot, commitMonitorRun } from './lib/monitor-runtime.mjs';
import { buildReport } from './monitor-olx-notebooks-por-cpu.mjs';
import { buildMercadoLivreChanges, renderMercadoLivreReport } from './lib/mercadolivre-production.mjs';

// Offline preference migration. Keep collection and evidence timestamps intact;
// the manifest records when the policy was applied, without adding a collection.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const source of ['olx', 'mercadolivre-notebooks']) {
  const dataDir = path.join(root, 'data', source);
  const { snapshot: previous } = await readLatestValidSnapshot(dataDir);
  if (!previous || previous.run?.notebook_policy_version === NOTEBOOK_POLICY_VERSION) continue;
  const snapshot = structuredClone(previous);
  const appliedAt = new Date().toISOString();
  snapshot.run = { ...snapshot.run, policy_reclassification: true,
    notebook_policy_version: NOTEBOOK_POLICY_VERSION, policy_applied_at: appliedAt };
  for (const key of ['configured_coverage', 'configured_terms']) {
    if (Array.isArray(snapshot.run[key])) snapshot.run[key] = snapshot.run[key].filter(term => DEFAULT_CPU_TERMS.includes(term));
  }
  snapshot.coverage_status = Object.fromEntries(Object.entries(snapshot.coverage_status ?? {}).filter(([term]) => DEFAULT_CPU_TERMS.includes(term)));
  if (source === 'olx') {
    snapshot.items = snapshot.items.map(revalidateSavedOlxItem).map(item => item.validation?.state === 'rejected'
      ? { ...item, status: 'out_of_scope', out_of_scope_at: item.out_of_scope_at ?? appliedAt } : item);
    const pool = snapshot.items.filter(item => item.status === 'active' && isValidatedOlxItem(item));
    snapshot.items = snapshot.items.map(item => isValidatedOlxItem(item) ? { ...item, opportunity: notebookOpportunity(item, pool) } : item);
  } else {
    snapshot.items = snapshot.items.map(item => {
      const assessment = assessNotebook(item, item.description ?? item.description_evidence ?? '');
      if (assessment.state !== 'rejected' && (item.notebook_validation?.version !== NOTEBOOK_POLICY_VERSION
          || !Number.isFinite(Date.parse(item.details_checked_at)) || Date.now() - Date.parse(item.details_checked_at) > 24 * 3600_000)) {
        assessment.state = 'pending'; assessment.reasons.push('Nova leitura da ficha técnica necessária');
      }
      return { ...item, notebook_validation: assessment,
        ...(assessment.state === 'rejected' ? { status: 'out_of_scope', out_of_scope_at: item.out_of_scope_at ?? appliedAt } : {}) };
    });
  }
  const report = source === 'olx' ? buildReport({ runDate: snapshot.run.date ?? snapshot.generated_at.slice(0,10),
    snapshot, previousSnapshot: previous, priceMin: 2000, priceMax: 8000 })
    : renderMercadoLivreReport(snapshot, buildMercadoLivreChanges(previous, snapshot, { displayMinPrice: 2000, displayMaxPrice: 8000, kind: 'notebook' }));
  await commitMonitorRun(dataDir, { runId: appliedAt.replace(/[:.]/g, '-'), snapshot, report,
    metadata: { source, policy_reclassification: true, policy_version: NOTEBOOK_POLICY_VERSION,
      source_collected_at: previous.run.completed_at ?? previous.generated_at } });
  const eligible = snapshot.items.filter(item => item.status === 'active' && (source === 'olx' ? isValidatedOlxItem(item) : isEligibleNotebook(item)) && item.price_brl <= 8000);
  console.log(`${source}: regras reaplicadas; ${eligible.length} oferta(s) elegível(is) até R$ 8.000. Horário da coleta preservado.`);
}
