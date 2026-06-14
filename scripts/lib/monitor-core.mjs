export const MONITOR_SNAPSHOT_SCHEMA_VERSION = 2;

export function normalizeMonitorText(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function normalizeMonitorCode(value) {
  return normalizeMonitorText(value).replace(/[^a-z0-9]/g, "");
}

export function monitorItemKey(item) {
  return item?.id ?? item?.url;
}

export function dedupeMonitorItems(items, { prefer = (current) => current } = {}) {
  const byKey = new Map();
  for (const item of items ?? []) {
    const key = monitorItemKey(item);
    if (!key) continue;
    const current = byKey.get(key);
    byKey.set(key, current ? prefer(current, item) : item);
  }
  return [...byKey.values()];
}

export function mergeMonitorSnapshot({
  previousSnapshot,
  collected,
  now = new Date(),
  run = {},
  filters = {},
  scheduledCoverage = [],
  successfulCoverage = scheduledCoverage,
  failedCoverage = [],
  configuredCoverage = scheduledCoverage,
  itemCoverage = defaultItemCoverage,
  dedupe = dedupeMonitorItems,
}) {
  const timestamp = now.toISOString();
  const runDate = timestamp.slice(0, 10);
  const previousItems = previousSnapshot?.items ?? [];
  const previousByKey = new Map(previousItems.map((item) => [monitorItemKey(item), item]));
  const current = dedupe(collected ?? []);
  const currentKeys = new Set(current.map(monitorItemKey));
  const scheduled = new Set(scheduledCoverage);
  const successful = new Set(successfulCoverage);
  const failed = new Set(failedCoverage);
  const configured = new Set(configuredCoverage);

  const items = current.map((item) => {
    const old = previousByKey.get(monitorItemKey(item));
    const history = [...(old?.price_history ?? [])];
    if (!old || Number(old.price_brl) !== Number(item.price_brl)) {
      history.push({ at: timestamp, price_brl: item.price_brl });
    }
    return {
      ...old,
      ...item,
      first_seen: old?.first_seen ?? runDate,
      last_seen: runDate,
      status: "active",
      out_of_scope_at: null,
      price_history: history,
    };
  });

  for (const old of previousItems) {
    if (currentKeys.has(monitorItemKey(old))) continue;
    const originalCoverage = itemCoverage(old);
    const coverage = originalCoverage.filter((key) => configured.size === 0 || configured.has(key));
    const removedFromConfiguration = configured.size > 0
      && originalCoverage.length > 0
      && coverage.length === 0;
    if (removedFromConfiguration) {
      items.push({
        ...old,
        status: "out_of_scope",
        out_of_scope_at: old.out_of_scope_at ?? timestamp,
      });
      continue;
    }
    const wasScheduled = coverage.length > 0 && coverage.every((key) => scheduled.has(key));
    const hasFailure = coverage.some((key) => failed.has(key));
    const hasSuccess = coverage.some((key) => successful.has(key));
    const preserve = !wasScheduled || hasFailure || !hasSuccess;
    items.push(preserve ? { ...old } : {
      ...old,
      status: "not_seen",
      last_seen: old.last_seen ?? runDate,
    });
  }

  return {
    schema_version: MONITOR_SNAPSHOT_SCHEMA_VERSION,
    generated_at: timestamp,
    run: {
      date: runDate,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...run,
      scheduled_coverage: [...scheduled],
      successful_coverage: [...successful],
      failed_coverage: [...failed],
      configured_coverage: [...configured],
    },
    filters,
    items,
  };
}

export function buildMonitorChanges(previousSnapshot, currentSnapshot, {
  include = (item) => item.status === "active",
  reactivationIsNew = true,
} = {}) {
  const previousByKey = new Map((previousSnapshot?.items ?? []).map((item) => [monitorItemKey(item), item]));
  const newItems = [];
  const priceChanges = [];
  for (const item of currentSnapshot?.items ?? []) {
    if (!include(item)) continue;
    const old = previousByKey.get(monitorItemKey(item));
    if (!old || (reactivationIsNew && old.status !== "active")) {
      newItems.push(item);
      continue;
    }
    if (Number(old.price_brl) !== Number(item.price_brl)) {
      priceChanges.push({ ...item, previous_price_brl: old.price_brl });
    }
  }
  return { newItems, priceChanges };
}

function defaultItemCoverage(item) {
  if (Array.isArray(item.coverage)) return item.coverage;
  if (Array.isArray(item.terms)) return item.terms;
  if (item.source && item.term) return [`${item.source}:${item.term}`];
  if (item.term) return [item.term];
  return [];
}
