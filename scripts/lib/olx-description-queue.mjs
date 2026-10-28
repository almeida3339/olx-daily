import { extractNotebookRamText, NOTEBOOK_MIN_RAM_GB, hasExplicitOtherNotebookCpu, notebookExclusionReason } from './notebook-policy.mjs';
import { extractOlxId, textContainsCpuTerm, extractGpuLabel } from './parsers.mjs';
import { DEFAULT_CPU_TERMS } from './cpu-terms.mjs';
import { readJsonValidated, writeJsonAtomic } from './monitor-runtime.mjs';
import { isOlxRecommendationUrl } from './olx-listing.mjs';
import { reserveOlxAccess } from './olx-traffic.mjs';

export const cardKey = card => extractOlxId(card.url) ?? card.url.split('?')[0];
const fingerprint = card => JSON.stringify([card.title, card.price_brl]);
const candidateAllowed = card => {
  const text = `${card.title}\n${card.text ?? ''}`;
  return !isOlxRecommendationUrl(card.url) && !hasExplicitOtherNotebookCpu(text)
    && !notebookExclusionReason(text)
    && (extractNotebookRamText(text) ?? NOTEBOOK_MIN_RAM_GB) >= NOTEBOOK_MIN_RAM_GB;
};
const evidenceScore = card => {
  const text = `${card.title}\n${card.text ?? ''}`;
  return 4 * Number(DEFAULT_CPU_TERMS.some(cpu => textContainsCpuTerm(text, cpu)))
    + 2 * Number((extractNotebookRamText(text) ?? 0) >= NOTEBOOK_MIN_RAM_GB)
    + Number(Boolean(extractGpuLabel(text)));
};
export function cardCpuState(text, term) {
  if (textContainsCpuTerm(text, term)) return 'match';
  if (DEFAULT_CPU_TERMS.some(cpu => textContainsCpuTerm(text, cpu))) return 'other';
  // Only explicit model numbers identify another CPU; "i7" alone is insufficient.
  if (hasExplicitOtherNotebookCpu(text)) return 'other';
  return 'unknown';
}

export async function createDescriptionQueue(file, round, { perTerm = 2, perRound = 8 } = {}) {
  const old = await readJsonValidated(file).catch(() => null);
  const now = Date.now();
  const state = {
    schema_version: 1, round,
    queue: (old?.queue ?? []).filter(entry => candidateAllowed(entry.card)
      && now - Date.parse(entry.last_observed_at) < 7 * 86400_000),
    cache: (old?.cache ?? []).filter(entry => now - Date.parse(entry.checked_at) < 72 * 3600_000),
    metrics: old?.round === round ? old.metrics : { extra_details: 0, total_details: 0, detail_ms: 0, recovered_validated: 0, cache_hits: 0, by_term: {} },
  };
  const results = new Map();
  const save = () => writeJsonAtomic(file, state, { validate: null });
  const totalLimit = Number(process.env.OLX_DETAIL_MAX ?? 12);
  const newReserved = Math.min(3, Math.ceil(totalLimit / 4));
  const ready = entry => !entry.next_retry_at || Date.parse(entry.next_retry_at) <= Date.now();
  const summary = () => ({ ...state.metrics, total_detail_limit: totalLimit, queued_candidates: state.queue.length,
    retry_waiting: state.queue.filter(entry => !ready(entry)).length, new_candidate_reserve: newReserved,
    validation_complete: state.queue.length === 0, per_term_limit: perTerm, per_round_limit: perRound });
  return {
    summary, save,
    cached(card) {
      const key = cardKey(card);
      const entry = state.cache.find(x => x.key === key && x.title === card.title && x.price_brl === card.price_brl
        && Date.now() - Date.parse(x.checked_at) < (x.item?.validation?.state === 'rejected' ? 72 : x.item?.validation?.state === 'pending' ? 0.5 : 12) * 3600_000);
      return entry?.item ?? null;
    },
    result(card) {
      const item = results.get(cardKey(card));
      return item?.title === card.title && item.validation?.listing_price_brl === card.price_brl ? item : null;
    },
    async enqueue(cards, term) {
      for (const card of cards) {
        if (!candidateAllowed(card)) continue;
        const key = cardKey(card), existing = state.queue.find(x => x.key === key);
        if (existing) {
          if (fingerprint(existing.card) !== fingerprint(card)) {
            existing.detail_attempts = 0; delete existing.last_detail_attempt_at; delete existing.next_retry_at;
          }
          existing.card = card; existing.last_observed_at = new Date().toISOString();
          if (!existing.terms.includes(term)) existing.terms.push(term);
        } else state.queue.push({ key, card: { ...card, description_discovery: card.description_discovery ?? true }, terms: [term], first_observed_at: new Date().toISOString(), last_observed_at: new Date().toISOString() });
      }
      // Bound disk use; preserve oldest waiting candidates first.
      state.queue = state.queue.slice(0, 500);
      await save();
    },
    pending(term) { return state.queue.filter(x => ready(x) && (term == null || x.terms.includes(term)))
      .sort((a,b)=>Number(Boolean(a.last_detail_attempt_at))-Number(Boolean(b.last_detail_attempt_at))
        || evidenceScore(b.card) - evidenceScore(a.card)
        || Number(a.card.price_brl) - Number(b.card.price_brl)
        ||(Date.parse(a.last_detail_attempt_at??a.first_observed_at)||0)-(Date.parse(b.last_detail_attempt_at??b.first_observed_at)||0))
      .map(x => ({ ...x.card, cpu_term: term ?? x.card.cpu_term ?? x.terms[0], description_discovery: x.card.description_discovery ?? true })); },
    async reserveDetail(term, discovery, card, { finishRound = false } = {}) {
      if (card && !candidateAllowed(card)) return false;
      let waiting = card && state.queue.find(entry => entry.key === cardKey(card));
      if (waiting && fingerprint(waiting.card) !== fingerprint(card)) {
        waiting.card = card; waiting.detail_attempts = 0;
        delete waiting.last_detail_attempt_at; delete waiting.next_retry_at;
      }
      if (waiting && !ready(waiting)) return false;
      const retry = Boolean(waiting?.last_detail_attempt_at);
      if (retry && !finishRound && (state.metrics.retry_details ?? 0) >= totalLimit - newReserved) return false;
      if ((state.metrics.total_details ?? 0) >= totalLimit) return false;
      const termLimit=term.startsWith('family:')?Math.max(perTerm,4):perTerm;
      if (discovery && ((state.metrics.by_term[term] ?? 0) >= termLimit || state.metrics.extra_details >= perRound)) return false;
      try{await reserveOlxAccess({watchlist:'notebooks',query:term,kind:'detail'});}
      catch(error){if(error.kind!=='deferred')throw error;state.metrics.traffic_deferred=(state.metrics.traffic_deferred??0)+1;state.metrics.traffic_reason=error.message;await save();return false;}
      state.metrics.total_details = (state.metrics.total_details ?? 0) + 1;
      if (card && !waiting) {
        waiting = { key: cardKey(card), card, terms: [term], first_observed_at: new Date().toISOString(), last_observed_at: new Date().toISOString() };
        state.queue.push(waiting);
      }
      if(waiting){waiting.last_detail_attempt_at=new Date().toISOString();waiting.detail_attempts=(waiting.detail_attempts??0)+1;}
      const counter = retry ? 'retry_details' : 'new_details';
      state.metrics[counter] = (state.metrics[counter] ?? 0) + 1;
      if (discovery) { state.metrics.extra_details++; state.metrics.by_term[term] = (state.metrics.by_term[term] ?? 0) + 1; }
      await save(); return true;
    },
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
      if (item.validation?.state === 'pending') {
        const waiting = state.queue.find(x => x.key === key);
        if (waiting) {
          waiting.last_detail_attempt_at = new Date().toISOString();
          waiting.last_reasons = item.validation?.reasons ?? [];
          const hours = waiting.detail_attempts >= 3 ? 72 : waiting.detail_attempts >= 2 ? 24 : 6;
          waiting.next_retry_at = new Date(Date.now() + hours * 3600_000).toISOString();
        }
      } else state.queue = state.queue.filter(x => x.key !== key);
      if (card.description_discovery && elapsed) {
        state.metrics.detail_ms += elapsed;
        if (item.validation?.state === 'validated') state.metrics.recovered_validated++;
      }
      await save();
    },
    async useCached(card, item) {
      state.metrics.cache_hits++;
      results.set(cardKey(card), item);
      if (item.validation?.state !== 'pending') state.queue = state.queue.filter(x => x.key !== cardKey(card));
      await save();
    },
  };
}
