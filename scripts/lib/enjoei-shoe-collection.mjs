import path from 'node:path';
import fs from 'node:fs/promises';
import { collectEnjoeiPages } from './enjoei-pagination.mjs';
import { writeJsonAtomic } from './monitor-runtime.mjs';
import { classifyBarefootShoe, matchesEnjoeiShoeSearchTerm, SHOE_RULES_VERSION, ENJOEI_SHOE_TERMS, barefootPriority } from './shoe-search-rules.mjs';
import { ENJOEI_SHOE_PLAN, shoeQuerySchedule } from './enjoei-shoe-plan.mjs';

async function readOptional(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}

export async function collectEnjoeiShoes({ dataDir, terms, department, shoeSize, shippingRange, state, city,
  first = 30, maxPriceBrl = 500, maxPagesPerTerm = 2, maxPages = 12, discoveryPages = 6, maxMinutes = 3, detailMax = 4,
  explicitTerms = true, fetchImpl = globalThis.fetch, delayMs = 350 }) {
  const identity = { department, shoeSize, shippingRange, state, city, first, maxPriceBrl };
  const configuration = JSON.stringify(identity);
  const progressPath = path.join(dataDir, 'collection-progress.json');
  const cachePath = path.join(dataDir, 'shoe-detail-cache.json');
  const saved = await readOptional(progressPath);
  let oldIdentity;
  try { const { version, terms: oldTerms, ...filters } = JSON.parse(saved?.configuration ?? '{}'); oldIdentity = filters; } catch {}
  const sameFilters = Object.entries(identity).every(([key, value]) => oldIdentity?.[key] === value);
  const progress = sameFilters ? saved : { configuration, terms: {} };
  progress.configuration = configuration;
  progress.introduced_at ??= new Date().toISOString();
  progress.query_introduced_at ??= {};
  const specs = explicitTerms ? terms.map(term => ({ id: term, term, tier: 'priority', interval_hours: 0 })) : ENJOEI_SHOE_PLAN;
  for (const spec of specs) {
    const old = progress.terms[spec.id];
    progress.query_introduced_at[spec.id] ??= old ? progress.introduced_at : new Date().toISOString();
    if (old?.complete && !old.completed_at) old.completed_at = progress.updated_at ?? progress.introduced_at;
    if (old && old.query_identity !== undefined && old.query_identity !== JSON.stringify({ term: spec.term, department: spec.department === null ? null : department })) delete progress.terms[spec.id];
  }
  const cache = (await readOptional(cachePath)) ?? {};
  const deadline = Date.now() + maxMinutes * 60_000;
  const failedTerms = [], incompleteTerms = [], successfulTerms = [], errors = [];
  const byId = new Map();
  const scheduledTerms = [], deferredTerms = [], refreshedTerms = [];
  const queryYield = {};
  const now = Date.now();
  const due = spec => spec.tier === 'priority' || !progress.terms[spec.id]?.complete
    || !progress.terms[spec.id]?.completed_at || now - Date.parse(progress.terms[spec.id].completed_at) >= spec.interval_hours * 3600_000;
  const oldest = (a,b) => Date.parse(progress.terms[a.id]?.last_attempt_at ?? '1970-01-01') - Date.parse(progress.terms[b.id]?.last_attempt_at ?? '1970-01-01');
  const queue = [...specs.filter(s => s.tier === 'priority'),
    ...specs.filter(s => s.tier === 'daily' && due(s)).sort(oldest),
    ...specs.filter(s => s.tier === 'rotation' && due(s)).sort(oldest),
    ...specs.filter(s => s.tier === 'discovery' && due(s)).sort(oldest)];
  let pagesFetched = 0, detailsFetched = 0, cacheHits = 0;
  const roundStarted = Date.now();
  let regularFetched = 0, discoveryFetched = 0;
  const resolvedEvidence = new Map();
  const evidenceFor = async item => {
    if (resolvedEvidence.has(item.id)) return resolvedEvidence.get(item.id);
    const cached = cache[item.id];
    const sameListing = cached?.title === item.title && cached?.brand === item.brand;
    const ttl = barefootPriority(item) === 0 ? 24 * 3600_000 : 7 * 86400_000;
    let evidence = null;
    if (sameListing && Date.now() - Date.parse(cached.checked_at) < ttl) {
      evidence = cached; cacheHits++;
    } else if (detailsFetched < detailMax && Date.now() < deadline) {
      detailsFetched++;
      try {
        const response = await fetchImpl(`https://pages.enjoei.com.br/products/${item.id}/v2.json`, {
          signal: AbortSignal.timeout(Math.max(1, Math.min(15000, deadline - Date.now()))) });
        if (!response.ok) throw new Error(`Detalhe HTTP ${response.status}`);
        const product = await response.json();
        if (String(product.id ?? item.id) !== item.id) throw new Error('Detalhe de outro produto');
        evidence = { title: item.title, brand: item.brand, price_brl: item.price_brl,
          text: `${product.title ?? ''}\n${product.description ?? ''}`.slice(0, 12000), checked_at: new Date().toISOString() };
        cache[item.id] = evidence;
        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      } catch (error) { item.detail_error = error.message; }
    }
    resolvedEvidence.set(item.id, evidence);
    return evidence;
  };
  const candidateFromNode = (node, term) => {
    if (!node?.id || !node.path) return null;
    const options = node.variations?.options ?? [];
    const available = options.length ? options.some(option => String(option.name) === shoeSize && option.available === true)
      : String(node.size?.name) === shoeSize;
    const price = Number(node.price?.current);
    if (!available || !(price > 0) || !Number.isFinite(price) || price > maxPriceBrl) return null;
    return { id: String(node.id), url: `https://www.enjoei.com.br/p/${node.path}`, title: node.title?.name ?? '',
      brand: node.brand?.displayable_name ?? null, price_brl: price, size: shoeSize,
      used: Boolean(node.used), shipping_free: Boolean(node.shipping?.free), store_name: node.store?.displayable?.name ?? null,
      store_path: node.store?.path ? `https://www.enjoei.com.br/${node.store.path}` : null,
      observed_at: new Date().toISOString(), search_terms: [term] };
  };
  const checkpoint = async () => {
    progress.updated_at = new Date().toISOString();
    await writeJsonAtomic(progressPath, progress, { validate: null });
  };
  for (const spec of queue) {
    const term = spec.id;
    const firstPageGate = /^fot(?:\s+(?:walka|lito|noga|voet|bruk))?$/.test(spec.term);
    const broadSearch = spec.tier === 'discovery';
    const remaining = broadSearch ? discoveryPages - discoveryFetched : maxPages - regularFetched;
    if (remaining <= 0 || Date.now() >= deadline) { deferredTerms.push(term); continue; }
    scheduledTerms.push(term);
    const pagesBefore = pagesFetched;
    let cursor = progress.terms[term];
    if (firstPageGate && (cursor?.first_page_policy !== 2 || !cursor.complete)) cursor = null;
    if (!cursor || cursor.complete || Date.now() - Date.parse(cursor.started_at) > 14 * 86400_000) {
      cursor = progress.terms[term] = { completed_at: cursor?.completed_at ?? null, started_at: new Date().toISOString(), after: null, pages: 0, complete: false, items: {}, seen_ids: [] };
    }
    cursor.query_identity = JSON.stringify({ term: spec.term, department: spec.department === null ? null : department });
    if (firstPageGate) cursor.first_page_policy = 2;
    if (cursor.stalled) { cursor.items = {}; cursor.seen_ids = []; }
    console.log(`Termo: ${term}${cursor.pages ? ` — retomando após ${cursor.pages} página(s)` : ''}`);
    try {
      const fetchPage = async (after, seenIds = cursor.seen_ids) => {
          cursor.last_attempt_at = new Date().toISOString();
          const url = new URL('https://enjusearch.enjoei.com.br/graphql-search-x');
          for (const [key, value] of Object.entries({ browser_id: 'codex-shoes', search_id: `codex-shoes-${Date.parse(cursor.started_at)}`,
            city, state, experienced_seller: 'true', first: String(first), operation_name: 'searchProducts',
            query_id: 'c5faa5f85fb47bf0beaa97b67d8a9189', search_context: 'products_search',
            shipping_range: shippingRange, 'size_types.shoes': shoeSize, term: spec.term,
          })) url.searchParams.set(key, value);
          if (spec.department !== null) url.searchParams.set('recommendation_context.recommendation_department', department);
          if (after != null) url.searchParams.set('after', after);
          pagesFetched++;
          if (broadSearch) discoveryFetched++; else regularFetched++;
          const response = await fetchImpl(url, { headers: { accept: 'application/json', origin: 'https://www.enjoei.com.br' },
            signal: AbortSignal.timeout(Math.max(1, Math.min(20000, deadline - Date.now()))) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          if (payload.errors?.length) throw new Error('API retornou erros GraphQL');
          const products = payload?.data?.search?.products;
          if (!Array.isArray(products?.edges)) throw new Error('Resposta sem produtos');
          if (firstPageGate && after == null) {
            const matches = products.edges.filter(({ node }) => matchesEnjoeiShoeSearchTerm({ title: node?.title?.name, brand: node?.brand?.displayable_name }, spec.term)).length;
            cursor.first_page_matches = matches;
            const candidates = products.edges.map(({node}) => candidateFromNode(node, term)).filter(item => item
              && matchesEnjoeiShoeSearchTerm(item, spec.term) && classifyBarefootShoe(item).state !== 'rejected');
            let eligible = candidates.some(item => classifyBarefootShoe(item).state === 'confirmed');
            // At most one uncertain model is inspected before permitting deep discovery.
            if (!eligible && candidates.length) {
              const item = candidates[0], evidence = await evidenceFor(item);
              eligible = classifyBarefootShoe(item, evidence?.text ?? '').state === 'confirmed';
            }
            cursor.first_page_candidates = candidates.length;
            cursor.first_page_eligible = eligible;
            cursor.stop_reason = matches === 0 && products.edges.length ? 'first_page_no_match'
              : !eligible && products.edges.length ? candidates.length ? 'first_page_model_pending' : 'first_page_no_candidate' : null;
            if (cursor.stop_reason) {
              // Relevance heuristic requested by the user, not proof of exhaustion.
              products.pageInfo = { ...products.pageInfo, hasNextPage: false };
              cursor.items = {}; cursor.seen_ids = [];
              console.log(`${term}: primeira página sem candidato elegível confirmado; paginação encerrada por relevância (${cursor.stop_reason}).`);
            }
          }
          // The API often omits pageInfo. Its explicit total can establish the end.
          const seen = new Set([...seenIds, ...products.edges.map(edge => String(edge.node?.id))]);
          if (products.total != null && Number(products.total) > 0 && seen.size >= Number(products.total)) {
            products.pageInfo = { ...products.pageInfo, hasNextPage: false };
          }
          return products;
        };
      const onPage = async (edges, trackCursor = true) => {
          const seen = new Set(cursor.seen_ids);
          for (const { node } of edges) {
            if (!node?.id || !node.path) continue;
            seen.add(String(node.id));
            const item = candidateFromNode(node, term);
            if (!item) continue;
            if (firstPageGate && !matchesEnjoeiShoeSearchTerm(item, spec.term)) continue;
            // Fuzzy results are discovery candidates only with some target evidence.
            if (!ENJOEI_SHOE_TERMS.some(search => matchesEnjoeiShoeSearchTerm(item, search))
                || classifyBarefootShoe(item).state === 'rejected') continue;
            cursor.items[item.id] = item;
          }
          if (trackCursor) cursor.seen_ids = [...seen];
        };
      // Refresh new priority listings without moving or corrupting the saved deep cursor.
      const refresh = (spec.tier === 'priority' || firstPageGate) && cursor.after != null && !cursor.stalled;
      const laterPriority = queue.slice(queue.indexOf(spec) + 1).filter(s => s.tier === 'priority').length;
      let allowance = Math.max(1, Math.min(broadSearch ? 6 : maxPagesPerTerm, remaining - laterPriority));
      if (firstPageGate) allowance = Math.min(allowance, Math.max(1, 2 - cursor.pages));
      let gatedComplete = false;
      if (refresh) {
        const firstPage = await fetchPage(null, []);
        await onPage(firstPage.edges, false);
        if (cursor.stop_reason) {
          cursor.complete = true; cursor.after = null; cursor.pages = 1;
          cursor.signatures = []; cursor.stalled = false; cursor.last_error = null;
          gatedComplete = true;
        }
        refreshedTerms.push(term);
        allowance--;
      }
      let result = gatedComplete ? { complete: true } : allowance > 0 ? await collectEnjoeiPages({
        progress: cursor, maxPages: allowance, deadline, checkpoint, fetchPage, onPage, delayMs,
      }) : { complete: false };
      if (firstPageGate && !result.complete && cursor.pages >= 2 && !cursor.stalled) {
        cursor.complete = true; cursor.after = null; cursor.stop_reason = 'discovery_page_limit'; cursor.last_error = null;
        result = { ...result, complete: true };
      }
      delete cursor.request_error;
      if (result.complete) cursor.completed_at = new Date().toISOString();
      await checkpoint();
      if (result.complete) successfulTerms.push(term);
      else incompleteTerms.push(term);
    } catch (error) {
      failedTerms.push(term); cursor.last_error = error.message; cursor.request_error = error.message;
      errors.push(`${term}: ${error.message}`);
      await checkpoint();
    }
    for (const item of Object.values(cursor.items)) {
      if (classifyBarefootShoe(item).state === 'rejected') continue;
      // Partial cycles must not make old pages look freshly observed.
      if (!cursor.complete && !(Date.parse(item.observed_at ?? '') >= roundStarted)) continue;
      const previous = byId.get(item.id);
      const newer = previous && Date.parse(previous.observed_at ?? '') > Date.parse(item.observed_at ?? '') ? previous : item;
      byId.set(item.id, { ...newer, search_terms: [...new Set([...(previous?.search_terms ?? []), term])] });
    }
    queryYield[term] = { pages_this_run: pagesFetched - pagesBefore, candidates_in_cycle: Object.keys(cursor.items).length };
    if (delayMs && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  const items = [], pendingItems = [];
  for (const item of [...byId.values()].sort((a,b) => barefootPriority(a) - barefootPriority(b))) {
    let assessment = classifyBarefootShoe(item);
    let evidence = null;
    if (assessment.state === 'pending') evidence = await evidenceFor(item);
    if (evidence) assessment = classifyBarefootShoe(item, evidence.text);
    item.description_evidence = evidence?.text ?? null;
    item.barefoot_validation = { ...assessment, version: SHOE_RULES_VERSION,
      description_checked_at: evidence?.checked_at ?? null };
    if (assessment.state === 'confirmed') items.push(item);
    else if (assessment.state === 'pending') pendingItems.push(item);
  }
  const cacheEntries = Object.entries(cache).sort((a,b) => Date.parse(b[1].checked_at) - Date.parse(a[1].checked_at)).slice(0,1000);
  await writeJsonAtomic(cachePath, Object.fromEntries(cacheEntries), { validate: null });
  await checkpoint();
  const schedule = Object.fromEntries(specs.map(spec => [spec.id, shoeQuerySchedule(spec, progress.terms[spec.id], progress.query_introduced_at[spec.id])]));
  const rejectedCachedIds = Object.entries(cache).filter(([,value]) => classifyBarefootShoe(value, value.text).state === 'rejected').map(([id]) => id);
  for (const [term, metrics] of Object.entries(queryYield)) {
    const found = items.filter(item => item.search_terms.includes(term));
    metrics.confirmed_in_run = found.length;
    metrics.exclusive_in_run = found.filter(item => item.search_terms.length === 1).length;
    metrics.pending_in_run = pendingItems.filter(item => item.search_terms.includes(term)).length;
  }
  return { items, pendingItems, rejectedCachedIds, failedTerms, incompleteTerms, successfulTerms, scheduledTerms, deferredTerms, schedule, errors,
    pagination: Object.fromEntries(scheduledTerms.map(term => [term, { pages: progress.terms[term].pages, complete: progress.terms[term].complete,
      stop_reason: progress.terms[term].stop_reason ?? null,
      exhaustive: progress.terms[term].complete && !progress.terms[term].stop_reason,
      total_reported: progress.terms[term].total_reported ?? null, reason: progress.terms[term].last_error ?? null }])),
    stats: { pages_fetched: pagesFetched, regular_pages: regularFetched, discovery_pages: discoveryFetched,
      page_budget: maxPages, discovery_budget: discoveryPages, refreshed_terms: refreshedTerms,
      details_fetched: detailsFetched, cache_hits: cacheHits, detail_budget: detailMax, query_yield: queryYield } };
}
