import { extractOlxId, textContainsCpuTerm } from './parsers.mjs';
import { DEFAULT_CPU_TERMS } from './cpu-terms.mjs';
import { readJsonValidated, writeJsonAtomic } from './monitor-runtime.mjs';

export const cardKey = card => extractOlxId(card.url) ?? card.url.split('?')[0];
export function cardCpuState(text, term) {
  if (textContainsCpuTerm(text, term)) return 'match';
  if (DEFAULT_CPU_TERMS.some(cpu => textContainsCpuTerm(text, cpu))) return 'other';
  // Only explicit model numbers identify another CPU; "i7" alone is insufficient.
  if (/\b\d{4,5}\s*(?:hx3d|hx|hs|hk|h|u)\b|\b(?:i[3579]|ryzen\s*[3579])\s*[- ]\s*\d{4,5}\b|\bultra\s*[579]\s*[- ]?\d{3}\b/i.test(text)) return 'other';
  return 'unknown';
}

export async function createDescriptionQueue(file, round, { perTerm = 2, perRound = 8 } = {}) {
  const old = await readJsonValidated(file).catch(() => null);
  const now = Date.now();
  const state = {
    schema_version: 1, round,
    queue: (old?.queue ?? []).filter(entry => now - Date.parse(entry.last_observed_at) < 7 * 86400_000),
    cache: (old?.cache ?? []).filter(entry => now - Date.parse(entry.checked_at) < 12 * 3600_000),
    metrics: old?.round === round ? old.metrics : { extra_details: 0, detail_ms: 0, recovered_validated: 0, cache_hits: 0, by_term: {} },
  };
  const results = new Map();
  const save = () => writeJsonAtomic(file, state, { validate: null });
  const summary = () => ({ ...state.metrics, queued_candidates: state.queue.length, validation_complete: state.queue.length === 0, per_term_limit: perTerm, per_round_limit: perRound });
  return {
    summary, save,
    cached(card) {
      const key = cardKey(card);
      const entry = state.cache.find(x => x.key === key && x.title === card.title && x.price_brl === card.price_brl
        && Date.now() - Date.parse(x.checked_at) < 12 * 3600_000);
      return entry?.item ?? null;
    },
    result(card) {
      const item = results.get(cardKey(card));
      return item?.title === card.title && item.validation?.listing_price_brl === card.price_brl ? item : null;
    },
    async enqueue(cards, term) {
      for (const card of cards) {
        const key = cardKey(card), existing = state.queue.find(x => x.key === key);
        if (existing) {
          existing.card = card; existing.last_observed_at = new Date().toISOString();
          if (!existing.terms.includes(term)) existing.terms.push(term);
        } else state.queue.push({ key, card, terms: [term], first_observed_at: new Date().toISOString(), last_observed_at: new Date().toISOString() });
      }
      // Bound disk use; preserve oldest waiting candidates first.
      state.queue = state.queue.slice(0, 500);
      await save();
    },
    pending(term) { return state.queue.filter(x => x.terms.includes(term)).map(x => ({ ...x.card, cpu_term: term, description_discovery: true })); },
    async reserve(term) {
      const used = state.metrics.by_term[term] ?? 0;
      if (used >= perTerm || state.metrics.extra_details >= perRound) return false;
      state.metrics.extra_details++; state.metrics.by_term[term] = used + 1;
      // Persist before navigation: an interruption cannot reset the access budget.
      await save(); return true;
    },
    async remember(card, item, elapsed = 0) {
      const key = cardKey(card);
      results.set(key, item);
      state.cache = state.cache.filter(x => x.key !== key);
      state.cache.push({ key, title: card.title, price_brl: card.price_brl, checked_at: new Date().toISOString(), item });
      state.cache = state.cache.slice(-1000);
      state.queue = state.queue.filter(x => x.key !== key);
      if (card.description_discovery && elapsed) {
        state.metrics.detail_ms += elapsed;
        if (item.validation?.state === 'validated') state.metrics.recovered_validated++;
      }
      await save();
    },
    async useCached(card, item) {
      state.metrics.cache_hits++;
      results.set(cardKey(card), item);
      state.queue = state.queue.filter(x => x.key !== cardKey(card));
      await save();
    },
  };
}
