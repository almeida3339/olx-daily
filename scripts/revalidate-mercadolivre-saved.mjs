// Offline policy repair. Never opens a browser, sends a notification or changes observation times.
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { mercadoLivreWatchlists } from './lib/mercadolivre-watchlists.mjs';
import { MERCADOLIVRE_WATCHLISTS, resolveWatchlistDataDir } from './lib/watchlists-registry.mjs';
import { assessNotebook, isEligibleNotebook } from './lib/notebook-policy.mjs';
import { assessMercadoLivreShoe, isApprovedMercadoLivreShoe } from './lib/mercadolivre-shoes.mjs';
import { classifySavedOledItem, hasApprovedOledEvidence, isApprovedOledMonitor } from './lib/oled-monitor-scope.mjs';
import { aggregateMercadoLivreInvocation } from './lib/mercadolivre-invocation.mjs';
import { recordRunFindings } from './lib/collection-summary.mjs';
import { renderMercadoLivreReport } from './lib/mercadolivre-production.mjs';
import { readLatestValidSnapshot, listCommittedRuns, commitMonitorRun, writeJsonAtomic } from './lib/monitor-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sinceArg = process.argv.indexOf('--since');
const since = sinceArg >= 0 ? Date.parse(process.argv[sinceArg + 1]) : null;
if (sinceArg >= 0 && !Number.isFinite(since)) throw new Error('--since exige uma data ISO válida');
const revisedAt = new Date().toISOString(), summaries = new Map();
const invocation = { id: `saved-repair-${revisedAt}`, started_at: Number.isFinite(since) ? new Date(since).toISOString() : revisedAt };
for (const spec of MERCADOLIVRE_WATCHLISTS.filter(spec => !spec.paused)) {
  const dir = resolveWatchlistDataDir(root, spec);
  const latest = await readLatestValidSnapshot(dir);
  if (!latest.snapshot) continue;
  const config = mercadoLivreWatchlists.find(config => `mercadolivre-${config.id}` === spec.id);
  const kind = spec.id === 'mercadolivre-notebooks' ? 'notebook' : config?.kind ?? 'product';
  const min = latest.snapshot.filters?.display_price_brl?.min ?? (kind === 'notebook' ? 2000 : config?.minPrice ?? 0);
  const max = latest.snapshot.filters?.display_price_brl?.max ?? (kind === 'notebook' ? 8000 : config?.maxPrice ?? Infinity);
  const eligible = item => kind === 'notebook' ? isEligibleNotebook(item) : kind === 'oled' ? hasApprovedOledEvidence(item) : kind === 'shoe' ? isApprovedMercadoLivreShoe(item) : true;
  const visible = item => item.status === 'active' && Number(item.price_brl) >= min && Number(item.price_brl) <= max
    && (kind === 'oled' ? isApprovedOledMonitor(item) : eligible(item));
  const repair = source => {
    const snapshot = structuredClone(source);
    snapshot.run.kind = kind;
    if (kind === 'notebook') snapshot.items = snapshot.items.map(item => ({ ...item, notebook_validation: assessNotebook(item) }));
    if (kind === 'shoe') snapshot.items = snapshot.items.map(item => ({ ...item, shoe_validation: assessMercadoLivreShoe(item),
      ...(!(item.terms ?? []).some(term => config.terms.includes(term)) ? { status: 'out_of_scope', scope_rejection_reason: 'Consulta ampla substituída por modelos barefoot' } : {}) }));
    if (kind === 'oled') snapshot.items = snapshot.items.map(classifySavedOledItem);
    const field = kind === 'notebook' ? 'notebook_validation' : kind === 'shoe' ? 'shoe_validation' : 'oled_validation';
    if (['notebook','shoe','oled'].includes(kind)) snapshot.pending_items = snapshot.items.filter(item => item.status === 'active'
      && item[field]?.state === 'pending' && Number(item.price_brl) >= min && Number(item.price_brl) <= max);
    return snapshot;
  };
  const original = (await listCommittedRuns(dir, { limit: 120 })).filter(run => !run.manifest.metadata?.policy_reclassification)
    .sort((a,b) => Date.parse(a.snapshot.run?.completed_at ?? a.snapshot.generated_at) - Date.parse(b.snapshot.run?.completed_at ?? b.snapshot.generated_at));
  const selected = Number.isFinite(since) ? original.filter(run => Date.parse(run.snapshot.run?.started_at ?? run.snapshot.generated_at) >= since
    && Date.parse(run.snapshot.run?.completed_at ?? run.snapshot.generated_at) <= Date.parse(latest.snapshot.run?.completed_at ?? latest.snapshot.generated_at)) : [];
  let snapshot = repair(latest.snapshot);
  if (selected.length) {
    const before = original.filter(run => Date.parse(run.snapshot.run?.completed_at ?? run.snapshot.generated_at) < Date.parse(selected[0].snapshot.run.started_at)).at(-1);
    let previous = before?.snapshot ?? null;
    for (const source of selected) {
      const current = repair(source.snapshot);
      aggregateMercadoLivreInvocation(previous, current, { invocation, visible, baselineEligible: eligible, displayMaxPrice: max });
      previous = current;
    }
    snapshot = previous;
  }
  snapshot.run.policy_reclassification = true;
  recordRunFindings(snapshot, { activeItems: snapshot.items.filter(visible), newItems: [], priceChanges: [] });
  const result = await commitMonitorRun(dir, { runId: new Date().toISOString().replace(/[:.]/g,'-'), snapshot,
    report: renderMercadoLivreReport(snapshot, { newItems: [], priceChanges: [], enteredDisplayRange: [] }),
    metadata: { source: spec.id, policy_reclassification: true, original_run_id: latest.manifest?.run_id, rebuilt_batches: selected.length } });
  summaries.set(spec.id, result.manifest.summary);
  console.log(`${spec.label}: ${selected.length || 1} lote(s) revisto(s); ${result.manifest.summary.findings.active_count} válido(s); coleta original ${snapshot.run.completed_at}.`);
}

const statusPath = path.join(root, 'data/status/latest-local.json');
let status;
try { status = JSON.parse(await fs.readFile(statusPath,'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (status?.monitoring?.scope === 'mercadolivre' && status.round_summary) {
  for (const source of status.round_summary.sources) if (summaries.has(source.id)) source.summary = summaries.get(source.id);
  const technical = source => ['failed','blocked'].includes(source.summary?.execution);
  const partial = source => source.summary?.coverage?.status !== 'complete';
  status.round_summary.revised_at = revisedAt;
  status.round_summary.execution = status.round_summary.sources.some(technical) ? 'failed' : 'success';
  status.monitoring.errors = (status.monitoring.errors ?? []).filter(error => !/limite de (?:resultados|p[aá]ginas)|or[cç]amento|fichas?.*pendentes?/i.test(error));
  status.monitoring.partial = status.round_summary.sources.some(partial);
  status.monitoring.status = status.monitoring.errors.length || status.round_summary.sources.some(technical) ? 'failed' : status.monitoring.partial ? 'partial' : 'success';
  status.monitoring.outcomes = status.round_summary.sources.map(source => ({ source: source.id, status: technical(source) ? source.summary.execution : partial(source) ? 'partial' : 'success',
    completed_terms: source.summary.coverage.completed, incomplete_terms: source.summary.coverage.incomplete, deferred_terms: source.summary.coverage.deferred }));
  await writeJsonAtomic(statusPath,status,{validate:null});
  const historyPath = path.join(root, 'data/status/run-history.json');
  try {
    const history = JSON.parse(await fs.readFile(historyPath,'utf8'));
    const entry = history.runs?.find(entry => entry.run_id === status.round_summary.run_id);
    if (entry) {
      entry.outcome = status.monitoring.status; entry.partial = status.monitoring.partial;
      entry.metadata = { ...entry.metadata, monitor_errors: status.monitoring.errors.length,
        monitor_failures: status.monitoring.errors, status_reclassified_at: revisedAt };
      await writeJsonAtomic(historyPath,history,{validate:null});
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log('Resumo local corrigido; datas de coleta e histórico de entrega preservados. Nenhuma mensagem enviada.');
}
