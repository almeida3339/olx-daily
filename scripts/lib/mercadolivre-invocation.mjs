import { randomUUID } from 'node:crypto';
import { classifyMonitorOutcome } from './monitor-outcome.mjs';

export function beginMercadoLivreInvocation() {
  process.env.ML_INVOCATION_ID ??= randomUUID();
  process.env.ML_INVOCATION_STARTED_AT ??= new Date().toISOString();
  return { id: process.env.ML_INVOCATION_ID, started_at: process.env.ML_INVOCATION_STARTED_AT };
}

// Keep the invocation baseline, not the preceding batch, as the alert reference.
export function aggregateMercadoLivreInvocation(previous, snapshot, { invocation, visible, baselineEligible, displayMaxPrice }) {
  const old = previous?.run?.invocation?.id === invocation.id ? previous.run.invocation : null;
  const baseline = old?.baseline ?? (previous?.items ?? []).map(item => ({
    id: item.id ?? item.url, price_brl: item.price_brl, eligible: baselineEligible(item),
  }));
  const run = snapshot.run;
  const batch = { id: run.started_at, scheduled_terms: run.scheduled_terms ?? [], successful_terms: run.successful_terms ?? [],
    failed_terms: run.failed_terms ?? [], deferred_terms: run.deferred_coverage ?? [],
    detail_reads: run.detail_reads ?? 0, pagination: run.pagination ?? {}, query_yield: run.query_yield ?? {},
    aborted: Boolean(run.aborted), blocked_error: run.blocked_error ?? null };
  const batches = [...(old?.batches ?? []).filter(value => value.id !== batch.id), batch];
  const terms = new Map();
  for (const b of batches) {
    for (const term of b.successful_terms) terms.set(term, null);
    for (const failure of b.failed_terms) terms.set(failure.term, failure);
  }
  const failed = [...terms.values()].filter(Boolean);
  const aggregate = { ...invocation, baseline, batches,
    scheduled_terms: [...new Set(batches.flatMap(b => b.scheduled_terms))],
    successful_terms: [...terms].filter(([, failure]) => !failure).map(([term]) => term), failed_terms: failed,
    deferred_coverage: [...new Set(batches.flatMap(b => b.deferred_terms))].filter(term => !terms.has(term)),
    errors: failed, limited_terms: failed.filter(value => value.kind === 'incomplete' || /limite|cobertura incompleta/i.test(value.error)).map(value => value.term),
    detail_reads: batches.reduce((sum,b) => sum + b.detail_reads, 0), pending_details: run.pending_details ?? 0,
    pagination: Object.assign({}, ...batches.map(b => b.pagination)), query_yield: Object.assign({}, ...batches.map(b => b.query_yield)),
    aborted: batches.some(b => b.aborted), blocked_error: batches.find(b => b.blocked_error)?.blocked_error ?? null,
  };
  if (aggregate.blocked_error) aggregate.errors = [...failed, aggregate.blocked_error];
  aggregate.partial = Boolean(failed.length || aggregate.deferred_coverage.length || aggregate.pending_details || aggregate.aborted);
  aggregate.operational = classifyMonitorOutcome(aggregate);
  snapshot.run.invocation = aggregate;
  const baselineById = new Map(baseline.map(item => [item.id, item]));
  const newItems = [], priceChanges = [];
  for (const item of snapshot.items.filter(visible)) {
    const old = baselineById.get(item.id ?? item.url);
    if (!old?.eligible) newItems.push(item);
    else if (Number(old.price_brl) !== Number(item.price_brl)) priceChanges.push({ ...item, previous_price_brl: old.price_brl });
  }
  return { newItems, priceChanges, enteredDisplayRange: priceChanges.filter(item => Number(item.previous_price_brl) > displayMaxPrice) };
}
