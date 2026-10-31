const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
const termOf = failure => typeof failure === 'string' ? failure : failure.term;
const unread = item => (item.validation?.reasons ?? []).some(reason => /ficha aguardando leitura/i.test(reason));
const relates = (item, term) => item.cpu_term === term || item.search_terms?.includes(term);
const scope = (min, max) => ({ min_price_brl:min, max_price_brl:max, scheduled_terms:[], completed_terms:[], incomplete_terms:[], pending_details:0 });

// Separate price scopes without changing the original collection/coverage history.
// Missing evidence is kept incomplete rather than inferred as an exhaustive search.
export function buildOlxPriceCoverage(snapshot, { offerMax = 8000, trackingMax = 10000, minPrice = 2000 } = {}) {
  const run = snapshot.run ?? {}, rows = run.query_yield ?? {};
  const scheduled = run.scheduled_coverage ?? run.scheduled_terms ?? [];
  const successful = new Set(run.successful_coverage ?? run.successful_terms ?? []);
  const failures = run.failed_terms ?? run.failed_coverage ?? [];
  const offers = scope(minPrice,offerMax), tracking = scope(offerMax,trackingMax);
  tracking.min_price_exclusive = true;
  const items = snapshot.items ?? [], started = Date.parse(run.started_at ?? '');
  const recent = item => Number.isFinite(started) && Date.parse(item.validation?.checked_at ?? '') >= started;
  const keyOf = item => String(item.id ?? item.url?.split('?')[0].match(/\d+$/)?.[0] ?? item.url?.split('?')[0]);
  const readAfterQueue = key => items.some(item => keyOf(item) === String(key) && recent(item) && !unread(item)
    && (item.validation?.description_checked || ['validated','rejected'].includes(item.validation?.state)));
  const pending = items.filter(item => item.status === 'active' && item.validation?.state !== 'validated'
    && item.validation?.state !== 'rejected' && (item.ram_gb == null || item.ram_gb >= 32));
  for (const term of scheduled) {
    const row = rows[term], failure = failures.find(value => termOf(value) === term);
    const waiting = items.filter(item => recent(item) && relates(item,term) && unread(item));
    const inferOffers = waiting.filter(item => number(item.price_brl) >= minPrice && number(item.price_brl) <= offerMax).length;
    const inferTracking = waiting.filter(item => number(item.price_brl) > offerMax && number(item.price_brl) <= trackingMax).length;
    const keys = row?.pending_detail_keys;
    const offerDetails = keys ? keys.offers.filter(key => !readAfterQueue(key)).length : row?.details_pending_offers ?? inferOffers;
    const trackingDetails = keys ? keys.tracking.filter(key => !readAfterQueue(key)).length : row?.details_pending_tracking ?? inferTracking;
    const classified = offerDetails + trackingDetails;
    const details = row?.details_pending ?? classified;
    const classifiedOriginal = keys ? keys.offers.length + keys.tracking.length : classified;
    const knownSplit = Boolean(row && (details === 0 || classifiedOriginal === details));
    const technical = failure && failure.kind !== 'incomplete';
    const readComplete = successful.has(term) || (!technical && knownSplit && row.listing_incomplete === false);
    offers.scheduled_terms.push(term); offers.pending_details += offerDetails;
    (readComplete && !offerDetails ? offers.completed_terms : offers.incomplete_terms).push(term);
    const observedTracking = row?.tracking_candidates ?? items.filter(item => recent(item) && relates(item,term)
      && number(item.price_brl) > offerMax && number(item.price_brl) <= trackingMax).length;
    if (observedTracking || trackingDetails) {
      tracking.scheduled_terms.push(term); tracking.pending_details += trackingDetails;
      (readComplete && !trackingDetails ? tracking.completed_terms : tracking.incomplete_terms).push(term);
    }
  }
  const queue = run.description_discovery;
  offers.queued_candidates = Number.isFinite(queue?.above_display_price) ? queue.queued_candidates - queue.above_display_price : null;
  tracking.queued_candidates = queue?.above_display_price ?? null;
  for (const [part, predicate] of [[offers,p=>p>=minPrice && p<=offerMax],[tracking,p=>p>offerMax && p<=trackingMax]]) {
    part.pending_candidates = pending.filter(item => predicate(number(item.price_brl))).length;
    part.scheduled = part.scheduled_terms.length;
    part.completed = part.completed_terms.length;
    part.incomplete = part.incomplete_terms.length;
    part.status = run.in_progress ? 'in_progress' : part.incomplete || part.pending_candidates || part.queued_candidates ? 'partial' : 'complete';
  }
  return {schema_version:1,offers,tracking};
}

export function olxPriceCoverageLines(value) {
  const {offers,tracking} = value;
  return [
    `Ofertas até R$ ${offers.max_price_brl.toLocaleString('pt-BR')}: ${offers.completed}/${offers.scheduled} consultas concluídas; ${offers.pending_candidates} candidatos pendentes; ${offers.pending_details} fichas adiadas nesta rodada`,
    `Acompanhamento acima de R$ ${offers.max_price_brl.toLocaleString('pt-BR')} até R$ ${tracking.max_price_brl.toLocaleString('pt-BR')}: ${tracking.pending_details} fichas adiadas nesta rodada; ${tracking.pending_candidates} candidatos pendentes`,
  ];
}
