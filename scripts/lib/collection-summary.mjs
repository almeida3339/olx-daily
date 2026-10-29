// Shared facts for the terminal, notifications and dashboard. Markdown is a view.
const projectItem = value => {
  const item = value.item ?? value;
  return { id: item.id ?? item.url, title: item.title, url: item.url, price_brl: item.price_brl,
    ...(value.from != null || value.previous_price_brl != null
      ? { previous_price_brl: value.from ?? value.previous_price_brl } : {}) };
};

export function recordRunFindings(snapshot, { newItems = [], priceChanges = [], activeItems, pendingItems } = {}) {
  snapshot.run ??= {};
  snapshot.run.findings = {
    new_items: newItems.map(projectItem), price_changes: priceChanges.map(projectItem),
    active_count: activeItems?.length ?? snapshot.items.filter(item => item.status === 'active').length,
    pending_count: pendingItems?.length ?? snapshot.pending_items?.length ?? 0,
  };
}

export function buildCollectionSummary(snapshot, operational = snapshot.run?.operational ?? {}) {
  const batchRun = snapshot.run ?? {}, run = batchRun.invocation ?? batchRun, findings = batchRun.findings;
  if (!['failed','blocked'].includes(operational.status)) operational = run.operational ?? operational;
  const scheduled = run.scheduled_coverage ?? run.scheduled_terms ?? [];
  const completed = run.successful_coverage ?? run.successful_terms ?? [];
  const incomplete = run.failed_coverage ?? run.failed_terms ?? [];
  const deferred = run.deferred_coverage ?? run.deferred_terms ?? [];
  const queue = run.description_discovery?.queued_candidates ?? 0;
  const pending = findings?.pending_count ?? snapshot.pending_items?.length
    ?? snapshot.items.filter(item => item.status === 'active' && item.validation?.state === 'pending').length;
  const heuristic = Object.entries(run.pagination ?? {}).filter(([, value]) => value.complete && value.exhaustive === false).map(([term]) => term);
  return {
    schema_version: 1, collected_at: run.completed_at ?? snapshot.generated_at,
    execution: ['failed', 'blocked'].includes(operational.status) ? operational.status : 'success',
    issues: operational.reasons ?? [],
    coverage: { status: run.in_progress ? 'in_progress' : operational.status === 'deferred' ? 'deferred'
      : run.partial || incomplete.length || queue || pending ? 'partial' : heuristic.length ? 'limited' : 'complete',
      scheduled: scheduled.length, completed: completed.length, incomplete: incomplete.length,
      deferred: deferred.length, pending_descriptions: queue, pending_candidates: pending,
      pending_details: run.pending_details ?? 0,
      heuristic_stops: heuristic,
      heuristic_reasons: Object.fromEntries(heuristic.map(term => [term, run.pagination[term].stop_reason])) },
    findings: findings ? { ...findings, new_count: findings.new_items.length, price_count: findings.price_changes.length } : null,
  };
}

export function collectionSummaryLine(source) {
  const s = source.summary;
  if (!s) return `${source.label}: resumo estruturado indisponível`;
  if (s.execution === 'failed' || s.execution === 'blocked') return `${source.label}: ${s.execution === 'blocked' ? 'acesso bloqueado' : 'falha na coleta'}`;
  const c = s.coverage;
  const parts = [`${c.completed}/${c.scheduled} buscas concluídas`];
  if (c.pending_descriptions) parts.push(`${c.pending_descriptions} descrições pendentes`);
  if (c.pending_details) parts.push(`${c.pending_details} fichas pendentes`);
  if (c.pending_candidates) parts.push(`${c.pending_candidates} candidatos pendentes`);
  if (c.incomplete) parts.push(`${c.incomplete} buscas incompletas`);
  if (c.deferred) parts.push(`${c.deferred} buscas adiadas`);
  if (c.heuristic_stops?.length) parts.push(`${c.heuristic_stops.length} buscas encerradas por limite de relevância ou descoberta`);
  if (c.status === 'partial' && !c.incomplete && !c.pending_descriptions && !c.pending_candidates) parts.push('cobertura parcial');
  if (s.findings) parts.push(`${s.findings.new_count} novo(s), ${s.findings.price_count} alteração(ões) de preço`);
  else parts.push('achados não apurados');
  return `${source.label}: ${parts.join('; ')}`;
}

// Every surface uses these same totals; pending products never become technical errors.
export function summarizeRound(round) {
  const summaries = (round.sources ?? []).map(source => source.summary).filter(Boolean);
  const sum = key => summaries.reduce((total, source) => total + (source.coverage?.[key] ?? 0), 0);
  const execution = round.execution ?? (summaries.some(source => ['failed','blocked'].includes(source.execution)) ? 'failed' : 'success');
  return { execution, scheduled: sum('scheduled'), completed: sum('completed'), incomplete: sum('incomplete'),
    deferred: sum('deferred'), pending_candidates: sum('pending_candidates'), pending_descriptions: sum('pending_descriptions'),
    pending_details: sum('pending_details'), limited_sources: summaries.filter(source => source.coverage?.status !== 'complete' || source.execution !== 'success').length };
}

export function roundSummaryLine(round) {
  const facts = summarizeRound(round);
  const parts = [facts.execution === 'success' ? 'Execução concluída' : 'Execução com falhas',
    `${facts.completed}/${facts.scheduled} consultas completas`, `${facts.pending_candidates} candidatos pendentes`];
  if (facts.incomplete) parts.push(`${facts.incomplete} consultas incompletas`);
  if (facts.deferred) parts.push(`${facts.deferred} consultas adiadas`);
  if (facts.pending_descriptions + facts.pending_details) parts.push(`${facts.pending_descriptions + facts.pending_details} fichas pendentes`);
  return parts.join(' · ');
}

export function collectionOutcome(source) {
  const { execution, coverage = {}, issues = [] } = source.summary;
  return { source: source.id, status: execution !== 'success' ? execution
    : coverage.status === 'deferred' ? 'deferred' : coverage.status === 'partial' || coverage.status === 'in_progress' ? 'partial' : 'success',
    completed_terms: coverage.completed ?? 0, incomplete_terms: coverage.incomplete ?? 0,
    deferred_terms: coverage.deferred ?? 0, pending_candidates: coverage.pending_candidates ?? 0, reasons: issues };
}
