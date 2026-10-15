import path from 'node:path';
import fs from 'node:fs/promises';
import { collectEnjoeiPages } from './enjoei-pagination.mjs';
import { writeJsonAtomic } from './monitor-runtime.mjs';
import { classifyBarefootShoe, matchesEnjoeiShoeSearchTerm, SHOE_RULES_VERSION } from './shoe-search-rules.mjs';

async function readOptional(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}

export async function collectEnjoeiShoes({ dataDir, terms, department, shoeSize, shippingRange, state, city,
  first = 30, maxPriceBrl = 500, maxPagesPerTerm = 6, maxPages = 48, maxMinutes = 3, detailMax = 8 }) {
  const configuration = JSON.stringify({ version: SHOE_RULES_VERSION, terms, department, shoeSize, shippingRange, state, city, first, maxPriceBrl });
  const progressPath = path.join(dataDir, 'collection-progress.json');
  const cachePath = path.join(dataDir, 'shoe-detail-cache.json');
  const saved = await readOptional(progressPath);
  const progress = saved?.configuration === configuration ? saved : { configuration, terms: {} };
  const cache = (await readOptional(cachePath)) ?? {};
  const deadline = Date.now() + maxMinutes * 60_000;
  const failedTerms = [], incompleteTerms = [], successfulTerms = [], errors = [];
  const byId = new Map();
  let pagesFetched = 0, detailsFetched = 0, cacheHits = 0;
  const checkpoint = async () => {
    progress.updated_at = new Date().toISOString();
    await writeJsonAtomic(progressPath, progress, { validate: null });
  };
  for (const term of terms) {
    let cursor = progress.terms[term];
    if (!cursor || cursor.complete || Date.now() - Date.parse(cursor.started_at) > 7 * 86400_000) {
      cursor = progress.terms[term] = { started_at: new Date().toISOString(), after: null, pages: 0, complete: false, items: {}, seen_ids: [] };
    }
    if (cursor.stalled) { cursor.items = {}; cursor.seen_ids = []; }
    console.log(`Termo: ${term}${cursor.pages ? ` — retomando após ${cursor.pages} página(s)` : ''}`);
    try {
      const result = await collectEnjoeiPages({
        progress: cursor, maxPages: Math.max(0, Math.min(maxPagesPerTerm, maxPages - pagesFetched)), deadline, checkpoint,
        fetchPage: async after => {
          const url = new URL('https://enjusearch.enjoei.com.br/graphql-search-x');
          for (const [key, value] of Object.entries({ browser_id: 'codex-shoes', search_id: `codex-shoes-${Date.parse(cursor.started_at)}`,
            city, state, experienced_seller: 'true', first: String(first), operation_name: 'searchProducts',
            query_id: 'c5faa5f85fb47bf0beaa97b67d8a9189', search_context: 'products_search',
            'recommendation_context.recommendation_department': department, shipping_range: shippingRange,
            'size_types.shoes': shoeSize, term,
          })) url.searchParams.set(key, value);
          if (after != null) url.searchParams.set('after', after);
          const response = await fetch(url, { headers: { accept: 'application/json', origin: 'https://www.enjoei.com.br' },
            signal: AbortSignal.timeout(Math.max(1, Math.min(20000, deadline - Date.now()))) });
          pagesFetched++;
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          if (payload.errors?.length) throw new Error('API retornou erros GraphQL');
          const products = payload?.data?.search?.products;
          if (!Array.isArray(products?.edges)) throw new Error('Resposta sem produtos');
          // The API often omits pageInfo. Its explicit total can establish the end.
          const seen = new Set([...cursor.seen_ids, ...products.edges.map(edge => String(edge.node?.id))]);
          if (products.total != null && Number(products.total) > 0 && seen.size >= Number(products.total)) {
            products.pageInfo = { ...products.pageInfo, hasNextPage: false };
          }
          return products;
        },
        onPage: async edges => {
          const seen = new Set(cursor.seen_ids);
          for (const { node } of edges) {
            if (!node?.id || !node.path) continue;
            seen.add(String(node.id));
            const options = node.variations?.options ?? [];
            const availableSize = options.length
              ? options.some(option => String(option.name) === shoeSize && option.available === true)
              : String(node.size?.name) === shoeSize;
            const price = node.price?.current;
            if (!availableSize || price == null || !Number.isFinite(Number(price)) || Number(price) <= 0 || Number(price) > maxPriceBrl) continue;
            const item = { id: String(node.id), url: `https://www.enjoei.com.br/p/${node.path}`, title: node.title?.name ?? '',
              brand: node.brand?.displayable_name ?? null, price_brl: Number(price), size: shoeSize,
              used: Boolean(node.used), shipping_free: Boolean(node.shipping?.free), store_name: node.store?.displayable?.name ?? null,
              store_path: node.store?.path ? `https://www.enjoei.com.br/${node.store.path}` : null, search_terms: [term] };
            // Fuzzy results are discovery candidates only with some target evidence.
            if (!terms.some(search => matchesEnjoeiShoeSearchTerm(item, search))) continue;
            cursor.items[item.id] = item;
          }
          cursor.seen_ids = [...seen];
        },
      });
      if (result.complete) successfulTerms.push(term);
      else incompleteTerms.push(term);
    } catch (error) {
      failedTerms.push(term); cursor.last_error = error.message;
      errors.push(`${term}: ${error.message}`);
      await checkpoint();
    }
    for (const item of Object.values(cursor.items)) {
      const previous = byId.get(item.id);
      byId.set(item.id, { ...item, search_terms: [...new Set([...(previous?.search_terms ?? []), term])] });
    }
    if (Date.now() < deadline && pagesFetched < maxPages) await new Promise(resolve => setTimeout(resolve, 350));
  }
  const items = [], pendingItems = [];
  for (const item of byId.values()) {
    let assessment = classifyBarefootShoe(item);
    const cached = cache[item.id];
    let evidence = null;
    const sameListing = cached?.title === item.title && cached?.brand === item.brand && cached?.price_brl === item.price_brl;
    if (assessment.state === 'pending' && sameListing && Date.now() - Date.parse(cached.checked_at) < 12 * 3600_000) {
      evidence = cached; cacheHits++;
    } else if (assessment.state === 'pending' && detailsFetched < detailMax && Date.now() < deadline) {
      detailsFetched++;
      try {
        const response = await fetch(`https://pages.enjoei.com.br/products/${item.id}/v2.json`, {
          signal: AbortSignal.timeout(Math.max(1, Math.min(15000, deadline - Date.now()))) });
        if (!response.ok) throw new Error(`Detalhe HTTP ${response.status}`);
        const product = await response.json();
        if (String(product.id ?? item.id) !== item.id) throw new Error('Detalhe de outro produto');
        evidence = { title: item.title, brand: item.brand, price_brl: item.price_brl,
          text: `${product.title ?? ''}\n${product.description ?? ''}`.slice(0, 12000), checked_at: new Date().toISOString() };
        cache[item.id] = evidence;
        await new Promise(resolve => setTimeout(resolve, 350));
      } catch (error) { item.detail_error = error.message; }
    }
    if (evidence) assessment = classifyBarefootShoe(item, evidence.text);
    item.barefoot_validation = { ...assessment, version: SHOE_RULES_VERSION,
      description_checked_at: evidence?.checked_at ?? null };
    if (assessment.state === 'confirmed') items.push(item);
    else if (assessment.state === 'pending') pendingItems.push(item);
  }
  const cacheEntries = Object.entries(cache).sort((a,b) => Date.parse(b[1].checked_at) - Date.parse(a[1].checked_at)).slice(0,1000);
  await writeJsonAtomic(cachePath, Object.fromEntries(cacheEntries), { validate: null });
  await checkpoint();
  return { items, pendingItems, failedTerms, incompleteTerms, successfulTerms, errors,
    pagination: Object.fromEntries(terms.map(term => [term, { pages: progress.terms[term].pages, complete: progress.terms[term].complete,
      total_reported: progress.terms[term].total_reported ?? null, reason: progress.terms[term].last_error ?? null }])),
    stats: { pages_fetched: pagesFetched, details_fetched: detailsFetched, cache_hits: cacheHits, detail_budget: detailMax } };
}
