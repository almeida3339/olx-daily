import { mergeMonitorSnapshot, monitorItemKey } from "./monitor-core.mjs";

// Compatibility wrapper for existing monitors. New code should call
// mergeMonitorSnapshot with explicit coverage scopes.
export function mergeWithPreviousSnapshot({
  runDate,
  collected,
  previousSnapshot,
  priceMin,
  priceMax,
  failedKeys = new Set(),
  // Chamadores de produção passam o instante real da execução. O fallback
  // preserva a compatibilidade dos testes e dos consumidores antigos.
  now = null,
}) {
  const allKeys = (previousSnapshot?.items ?? []).map(monitorItemKey).filter(Boolean);
  const collectedKeys = (collected ?? []).map(monitorItemKey).filter(Boolean);
  const configuredKeys = [...new Set([...allKeys, ...collectedKeys])];
  const successfulKeys = configuredKeys.filter((key) => !failedKeys.has(key));
  const result = mergeMonitorSnapshot({
    previousSnapshot,
    collected,
    now: now instanceof Date ? now : new Date(`${runDate}T12:00:00Z`),
    scheduledCoverage: configuredKeys,
    successfulCoverage: successfulKeys,
    failedCoverage: [...failedKeys],
    configuredCoverage: configuredKeys,
    itemCoverage: (item) => [monitorItemKey(item)],
  });
  if (priceMin != null && priceMax != null) {
    result.price_range_brl = { min: priceMin, max: priceMax };
    result.filters.price_brl = result.price_range_brl;
  }
  return result;
}
