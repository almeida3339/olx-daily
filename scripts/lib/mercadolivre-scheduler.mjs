import path from "node:path";
import { classifyMonitorError } from "./monitor-errors.mjs";
import { readJsonValidated, writeJsonAtomic } from "./monitor-runtime.mjs";

const DAY = 24 * 60 * 60 * 1000;
const SCHEDULE_SCHEMA_VERSION = 1;

export function createMercadoLivreSchedule() {
  return { schema_version: SCHEDULE_SCHEMA_VERSION, updated_at: null, global: {}, watchlists: {} };
}

export async function readMercadoLivreSchedule(root) {
  const filePath = schedulePath(root);
  try {
    return normalizeSchedule(await readJsonValidated(filePath));
  } catch {
    return createMercadoLivreSchedule();
  }
}

export async function writeMercadoLivreSchedule(root, schedule) {
  const normalized = normalizeSchedule(schedule);
  normalized.updated_at = new Date().toISOString();
  await writeJsonAtomic(schedulePath(root), normalized, { validate: null });
  return normalized;
}

export function planMercadoLivreTerms(schedule, { watchlistId, terms, now = new Date(), maxTerms = 6, force = false }) {
  const normalized = normalizeSchedule(schedule);
  const time = now.getTime();
  const blockedUntil = Date.parse(normalized.global.blocked_until ?? "");
  if (!force && normalized.global.requires_login) {
    return { terms: [], reason: "login_required", next_at: null, full_sweep_due: false };
  }
  if (!force && Number.isFinite(blockedUntil) && blockedUntil > time) {
    return { terms: [], reason: "cooldown", next_at: new Date(blockedUntil).toISOString(), full_sweep_due: false };
  }

  const state = normalized.watchlists[watchlistId] ?? { terms: {}, rotation_cursor: 0, last_full_sweep_at: null };
  const normalizedTerms = terms.map(normalizeTermTask);
  const due = normalizedTerms
    .map((task, index) => ({ task, index, state: state.terms[task.matchTerm] ?? {} }))
    .filter(({ state: termState }) => force || isTermDue(termState, time));
  const rotated = rotate(due, state.rotation_cursor ?? 0);
  const limit = Number.isFinite(Number(maxTerms)) ? Math.max(1, Math.floor(Number(maxTerms))) : 6;
  const selected = rotated.slice(0, limit);
  const nextAt = due.length > selected.length
    ? now.toISOString()
    : earliestNextAt(normalizedTerms, state, time);
  return {
    terms: selected.map(({ task }) => task.original),
    reason: selected.length ? null : "not_due",
    next_at: nextAt,
    full_sweep_due: !state.last_full_sweep_at || time - Date.parse(state.last_full_sweep_at) >= 7 * DAY,
    selected_keys: selected.map(({ task }) => task.matchTerm),
  };
}

export function recordMercadoLivreRun(schedule, {
  watchlistId,
  scheduledTerms,
  configuredTerms = scheduledTerms,
  snapshot,
  now = new Date(),
}) {
  const next = normalizeSchedule(structuredClone(schedule));
  const state = next.watchlists[watchlistId] ?? { terms: {}, rotation_cursor: 0, last_full_sweep_at: null };
  const run = snapshot?.run ?? {};
  const successful = new Set(run.successful_terms ?? []);
  const failures = new Map((run.failed_terms ?? []).map((entry) => [typeof entry === "string" ? entry : entry.term, entry]));
  const itemsByTerm = new Map();
  for (const item of snapshot?.items ?? []) {
    if (item.status !== "active") continue;
    for (const term of item.terms ?? (item.term ? [item.term] : [])) {
      itemsByTerm.set(term, (itemsByTerm.get(term) ?? 0) + 1);
    }
  }
  for (const raw of scheduledTerms ?? []) {
    const task = normalizeTermTask(raw);
    const current = state.terms[task.matchTerm] ?? {};
    const failure = failures.get(task.matchTerm);
    if (successful.has(task.matchTerm)) {
      const accepted = itemsByTerm.get(task.matchTerm) ?? 0;
      state.terms[task.matchTerm] = {
        ...current,
        last_checked_at: now.toISOString(),
        last_success_at: now.toISOString(),
        last_result_count: accepted,
        last_change_at: accepted > 0 ? now.toISOString() : current.last_change_at ?? null,
        empty_runs: accepted === 0 ? Number(current.empty_runs ?? 0) + 1 : 0,
        failures: 0,
        last_error: null,
      };
      next.global.requires_login = false;
      next.global.blocked_until = null;
      next.global.block_reason = null;
      continue;
    }
    const classification = classifyMonitorError(typeof failure === "string" ? failure : failure?.error ?? "coleta incompleta");
    state.terms[task.matchTerm] = {
      ...current,
      last_checked_at: now.toISOString(),
      failures: Number(current.failures ?? 0) + 1,
      last_error: classification.message,
    };
    if (classification.kind === "authentication") next.global.requires_login = true;
    if (["challenge", "rate_limited"].includes(classification.kind)) {
      const cooldown = classification.kind === "challenge" ? 24 * DAY : 12 * DAY;
      const until = new Date(now.getTime() + cooldown).toISOString();
      if (!next.global.blocked_until || Date.parse(next.global.blocked_until) < Date.parse(until)) next.global.blocked_until = until;
      next.global.block_reason = classification.kind;
    }
  }
  const configuredKeys = new Set((configuredTerms ?? []).map((raw) => normalizeTermTask(raw).matchTerm));
  const successfulThisRun = (scheduledTerms ?? [])
    .map((raw) => normalizeTermTask(raw).matchTerm)
    .filter((term) => successful.has(term));
  const sweepCoverage = new Set([...(state.full_sweep_coverage ?? []), ...successfulThisRun]);
  if (configuredKeys.size > 0 && [...configuredKeys].every((term) => sweepCoverage.has(term))) {
    state.last_full_sweep_at = now.toISOString();
    state.full_sweep_coverage = [];
  } else {
    state.full_sweep_coverage = [...sweepCoverage].filter((term) => configuredKeys.has(term));
  }
  state.rotation_cursor = (Number(state.rotation_cursor ?? 0) + Math.max(1, scheduledTerms?.length ?? 1)) % Math.max(1, Object.keys(state.terms).length || scheduledTerms?.length || 1);
  next.watchlists[watchlistId] = state;
  next.updated_at = now.toISOString();
  return next;
}

export function clearMercadoLivreCooldown(schedule) {
  const next = normalizeSchedule(structuredClone(schedule));
  next.global.blocked_until = null;
  next.global.block_reason = null;
  next.global.requires_login = false;
  return next;
}

function isTermDue(state, now) {
  if (!state.last_success_at) return true;
  const age = now - Date.parse(state.last_success_at);
  const recentChange = state.last_change_at && now - Date.parse(state.last_change_at) < 7 * DAY;
  const interval = recentChange ? DAY : Number(state.empty_runs ?? 0) >= 3 ? 7 * DAY : 3 * DAY;
  return !Number.isFinite(age) || age >= interval;
}

function earliestNextAt(terms, state, now) {
  const values = terms.map((task) => {
    const term = state.terms[task.matchTerm] ?? {};
    if (!term.last_success_at) return now;
    const changed = term.last_change_at && now - Date.parse(term.last_change_at) < 7 * DAY;
    const interval = changed ? DAY : Number(term.empty_runs ?? 0) >= 3 ? 7 * DAY : 3 * DAY;
    return Date.parse(term.last_success_at) + interval;
  }).filter(Number.isFinite);
  return values.length ? new Date(Math.min(...values)).toISOString() : null;
}

function rotate(items, cursor) {
  if (items.length < 2) return items;
  const offset = Math.abs(Number(cursor) || 0) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

function normalizeTermTask(value) {
  const matchTerm = String(typeof value === "string" ? value : value?.matchTerm ?? value?.query ?? "").trim().toLowerCase();
  return { original: value, matchTerm };
}

function normalizeSchedule(value) {
  const base = createMercadoLivreSchedule();
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  return {
    ...base,
    ...value,
    global: { ...base.global, ...(value.global ?? {}) },
    watchlists: value.watchlists && typeof value.watchlists === "object" ? value.watchlists : {},
  };
}

function schedulePath(root) {
  return path.join(root, "data", "status", "mercadolivre-schedule.json");
}
