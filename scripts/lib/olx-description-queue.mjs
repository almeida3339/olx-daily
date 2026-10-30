import { extractNotebookRamText, NOTEBOOK_MIN_RAM_GB, hasExplicitOtherNotebookCpu, notebookExclusionReason } from './notebook-policy.mjs';
import { extractOlxId, textContainsCpuTerm, extractGpuLabel } from './parsers.mjs';
import { DEFAULT_CPU_TERMS } from './cpu-terms.mjs';
import { readJsonValidated, writeJsonAtomic } from './monitor-runtime.mjs';
import { isOlxRecommendationUrl } from './olx-listing.mjs';
import { reserveOlxAccess } from './olx-traffic.mjs';

export const cardKey = card => extractOlxId(card.url) ?? card.url.split('?')[0];
const fingerprint = card => {
  const text = `${card.title}\n${card.text ?? ''}`;
  return JSON.stringify([card.title, card.price_brl, DEFAULT_CPU_TERMS.filter(cpu => textContainsCpuTerm(text,cpu)),
    extractNotebookRamText(text), extractGpuLabel(text)]);
};
const candidateAllowed = card => {
  const text = `${card.title}\n${card.text ?? ''}`;
  return !isOlxRecommendationUrl(card.url) && !hasExplicitOtherNotebookCpu(text)
    && !notebookExclusionReason(text)
    && (extractNotebookRamText(text) ?? NOTEBOOK_MIN_RAM_GB) >= NOTEBOOK_MIN_RAM_GB;
};
const evidenceScore = (card, evidence) => {
  const text = `${card.title}\n${card.text ?? ''}`;
  return 4 * Number(Boolean(DEFAULT_CPU_TERMS.some(cpu => textContainsCpuTerm(text, cpu)) || evidence?.cpu_confirmed))
    + 2 * Number((extractNotebookRamText(text) ?? evidence?.ram_gb ?? 0) >= NOTEBOOK_MIN_RAM_GB)
    + Number(Boolean(extractGpuLabel(text) ?? evidence?.gpu));
};
export function descriptionRetryPolicy(entry, item) {
  const reasons = item?.validation?.reasons ?? entry.last_reasons ?? [];
  const attempts = Math.max(1, entry.detail_attempts ?? 1);
  const transient = item?.validation?.description_checked === false
    || /n[aã]o localiz|n[aã]o consegui|timeout|net::|conex[aã]o|HTTP|aguardando leitura/i.test(reasons.join(' '));
  const configuration = !transient && /CPU n[aã]o confirmada|Especifica[cç][aã]o n[aã]o confirmada/i.test(reasons.join(' '));
  const conflict = !transient && /diverg|corresponde|entrada|parcela/i.test(reasons.join(' '));
  return configuration ? { kind: 'missing_configuration', hours: attempts === 1 ? 48 : 168 }
    : conflict ? { kind: 'conflicting_evidence', hours: attempts === 1 ? 24 : attempts === 2 ? 72 : 168 }
    : { kind: 'retryable_read', hours: attempts >= 3 ? 72 : attempts >= 2 ? 24 : 6 };
}
const clearAttempt = entry => {
  entry.detail_attempts = 0;
  for (const key of ['last_detail_attempt_at','next_retry_at','last_reasons','last_evidence','retry_kind']) delete entry[key];
};
export function compareDescriptionCandidates(a, b, displayMaxPrice = 8000) {
  return Number(a.card.price_brl > displayMaxPrice) - Number(b.card.price_brl > displayMaxPrice)
    || evidenceScore(b.card,b.last_evidence) - evidenceScore(a.card,a.last_evidence)
    || Number(a.retry_kind === 'missing_configuration') - Number(b.retry_kind === 'missing_configuration')
    || Number(Boolean(a.last_detail_attempt_at)) - Number(Boolean(b.last_detail_attempt_at))
    || Number(a.card.price_brl) - Number(b.card.price_brl)
    || (Date.parse(a.last_detail_attempt_at ?? a.first_observed_at) || 0) - (Date.parse(b.last_detail_attempt_at ?? b.first_observed_at) || 0);
}
export function cardCpuState(text, term) {
  if (textContainsCpuTerm(text, term)) return 'match';
  if (DEFAULT_CPU_TERMS.some(cpu => textContainsCpuTerm(text, cpu))) return 'other';
  // Only explicit model numbers identify another CPU; "i7" alone is insufficient.
  if (hasExplicitOtherNotebookCpu(text)) return 'other';
  return 'unknown';
}

export async function createDescriptionQueue(file, round, { perTerm = 2, perRound = 8, displayMaxPrice = 8000, reserveAccess = reserveOlxAccess } = {}) {
  const old = await readJsonValidated(file).catch(() => null);
  const now = Date.now();
  const state = {
    schema_version: 1, selection_policy_version: 2, round,
    queue: (old?.queue ?? []).filter(entry => candidateAllowed(entry.card)
      && now - Date.parse(entry.last_observed_at) < 7 * 86400_000),
    cache: (old?.cache ?? []).filter(entry => now - Date.parse(entry.checked_at) < 72 * 3600_000),
    metrics: old?.round === round ? old.metrics : { extra_details: 0, total_details: 0, detail_ms: 0, recovered_validated: 0, cache_hits: 0, by_term: {} },
  };
  const results = new Map();
  // Migrate pending retries without renewing observation or attempt timestamps.
  for (const entry of state.queue) {
    if (!entry.last_detail_attempt_at) continue;
    const cached = state.cache.find(value => value.key === entry.key && value.title === entry.card.title && value.price_brl === entry.card.price_brl)?.item;
    entry.last_evidence ??= cached ? { cpu_confirmed: Boolean(cached.validation?.cpu_confirmed),
      ram_gb: cached.ram_gb, gpu: cached.gpu } : null;
    const policy = descriptionRetryPolicy(entry,cached);
    entry.retry_kind = policy.kind;
    const planned = Date.parse(entry.last_detail_attempt_at) + policy.hours * 3600_000;
    if (Number.isFinite(planned)) entry.next_retry_at = new Date(Math.max(planned,Date.parse(entry.next_retry_at ?? '') || 0)).toISOString();
  }
  state.queue.sort((a,b) => compareDescriptionCandidates(a,b,displayMaxPrice));
  const save = () => writeJsonAtomic(file, state, { validate: null });
  const totalLimit = Number(process.env.OLX_DETAIL_MAX ?? 12);
  const newReserved = Math.min(3, Math.ceil(totalLimit / 4));
  const ready = entry => !entry.next_retry_at || Date.parse(entry.next_retry_at) <= Date.now();
  const summary = () => ({ ...state.metrics, total_detail_limit: totalLimit, queued_candidates: state.queue.length,
    retry_waiting: state.queue.filter(entry => !ready(entry)).length, new_candidate_reserve: newReserved,
    ready_within_price: state.queue.filter(entry => ready(entry) && entry.card.price_brl <= displayMaxPrice).length,
    waiting_for_configuration: state.queue.filter(entry => !ready(entry) && entry.retry_kind === 'missing_configuration').length,
    above_display_price: state.queue.filter(entry => entry.card.price_brl > displayMaxPrice).length,
    validation_complete: state.queue.length === 0, per_term_limit: perTerm, per_round_limit: perRound });
  return {
    summary, save,
    cached(card) {
      const key = cardKey(card);
      const entry = state.cache.find(x => x.key === key && x.title === card.title && x.price_brl === card.price_brl
        && (x.card_fingerprint ?? fingerprint({ ...x.item, title:x.title, price_brl:x.price_brl })) === fingerprint(card)
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
            clearAttempt(existing);
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
      .sort((a,b)=>compareDescriptionCandidates(a,b,displayMaxPrice))
      .map(x => ({ ...x.card, cpu_term: term ?? x.card.cpu_term ?? x.terms[0], description_discovery: x.card.description_discovery ?? true })); },
    prioritize(cards) {
      const entryFor = card => ({ ...(state.queue.find(entry => entry.key === cardKey(card)) ?? {}), card });
      return [...cards].sort((a,b) => compareDescriptionCandidates(entryFor(a),entryFor(b),displayMaxPrice));
    },
    async reserveDetail(term, discovery, card, { finishRound = false } = {}) {
      if (card && !candidateAllowed(card)) return false;
      let waiting = card && state.queue.find(entry => entry.key === cardKey(card));
      if (waiting && fingerprint(waiting.card) !== fingerprint(card)) {
        waiting.card = card; clearAttempt(waiting);
      }
      if (waiting && !ready(waiting)) return false;
      if (card?.price_brl > displayMaxPrice && state.queue.some(entry => entry.card.price_brl <= displayMaxPrice
        && ready(entry) && !results.has(entry.key))) return false;
      const retry = Boolean(waiting?.last_detail_attempt_at);
      if (retry && !finishRound && (state.metrics.retry_details ?? 0) >= totalLimit - newReserved) return false;
      if ((state.metrics.total_details ?? 0) >= totalLimit) return false;
      const termLimit=term.startsWith('family:')?Math.max(perTerm,4):perTerm;
      if (discovery && ((state.metrics.by_term[term] ?? 0) >= termLimit || state.metrics.extra_details >= perRound)) return false;
      try{await reserveAccess({watchlist:'notebooks',query:term,kind:'detail'});}
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
      state.cache.push({ key, title: card.title, price_brl: card.price_brl, card_fingerprint:fingerprint(card), checked_at: new Date().toISOString(), item });
      state.cache = state.cache.slice(-1000);
      if (item.validation?.state === 'pending') {
        const waiting = state.queue.find(x => x.key === key);
        if (waiting) {
          waiting.last_detail_attempt_at = new Date().toISOString();
          waiting.last_reasons = item.validation?.reasons ?? [];
          waiting.last_evidence = { cpu_confirmed: Boolean(item.validation?.cpu_confirmed), ram_gb: item.ram_gb, gpu: item.gpu };
          const policy = descriptionRetryPolicy(waiting,item);
          waiting.retry_kind = policy.kind;
          waiting.next_retry_at = new Date(Date.now() + policy.hours * 3600_000).toISOString();
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
