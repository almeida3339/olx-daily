import path from 'node:path';
import fs from 'node:fs/promises';
import { buildMonitorChanges, mergeMonitorSnapshot, normalizeMonitorText } from './monitor-core.mjs';
import { commitMonitorRun, readLatestValidSnapshot, writeJsonAtomic } from './monitor-runtime.mjs';

export async function runEnjoeiJeansMonitor({ id, label, brandName, term, brandPattern, dataDir, maxPrice = 250, inclusive = false, searchTerms = [term] }) {
  const coverage = searchTerms.map(query => `Enjoei:${query}`);
  const searchUrl = `https://www.enjoei.com.br/${encodeURIComponent(term.replaceAll(' ', '-'))}/s?q=${encodeURIComponent(term)}&st%5Bsw%5D=40&dep=masculino&cat=masculino-roupas&sub=masculino-roupas-calcas`;
  const priceLabel = `${inclusive ? 'até' : 'menos de'} R$ ${Number(maxPrice).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const money = value => Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function matches(node) {
    const price = node.price?.current;
    const text = normalizeMonitorText(`${node.title?.name ?? ''} ${node.brand?.displayable_name ?? ''}`);
    const department = node.categories?.department?.slug;
    const category = node.categories?.sub_category?.slug;
    const options = node.variations?.options ?? [];
    const size40 = options.length
      ? options.some(option => String(option.name) === '40' && option.available === true)
      : String(node.size?.name) === '40';
    return node.id && node.path && price != null && Number.isFinite(Number(price))
      && Number(price) > 0 && (inclusive ? Number(price) <= maxPrice : Number(price) < maxPrice)
      && brandPattern.test(text) && size40
      && (!department || ['masculino', 'rapazes'].includes(department))
      && (!category || ['masculino-roupas-calcas', 'rapazes-roupas-calcas'].includes(category));
  }

  async function collect() {
    const items = new Map();
    const pendingItems = [];
    let detailReads = 0;
    const detailCachePath = path.join(dataDir, 'denim-detail-cache.json');
    let detailCache;
    try { detailCache = JSON.parse(await fs.readFile(detailCachePath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; detailCache = {}; }
    let totalPages = 0;
    let scanned = 0;
    let cheapest = null;
    const session = `codex-${id}-${Date.now()}`;
    for (const queryTerm of searchTerms) {
      const seenIds = new Set();
      let after = null;
      let queryComplete = false;
      for (let page = 0; page < 10; page++) {
        const url = new URL('https://enjusearch.enjoei.com.br/graphql-search-x');
        for (const [key, value] of Object.entries({
          browser_id: session, search_id: session, operation_name: 'searchProducts',
          query_id: 'c5faa5f85fb47bf0beaa97b67d8a9189', search_context: 'products_search',
          first: '30', term: queryTerm, shipping_range: 'same_country',
          'size_types.waist': '40',
          'recommendation_context.recommendation_department': 'masculino',
          'recommendation_context.recommendation_category': 'masculino-roupas',
          'recommendation_context.recommendation_sub_category': 'masculino-roupas-calcas',
        })) url.searchParams.set(key, value);
        if (after != null) url.searchParams.set('after', after);
        const response = await fetch(url, {
          headers: { accept: 'application/json', origin: 'https://www.enjoei.com.br', referer: searchUrl },
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) throw new Error(`Enjoei HTTP ${response.status}`);
        const payload = await response.json();
        const products = payload?.data?.search?.products;
        if (payload.errors?.length || !Array.isArray(products?.edges)) throw new Error('Resposta de busca incompleta');
        const edges = products.edges;
        if (!edges.length && after == null && Number(products.total) > 0) throw new Error('Página vazia apesar de total positivo');
        let newIds = 0;
        for (const { node } of edges) {
          if (!node?.id || seenIds.has(String(node.id))) continue;
          seenIds.add(String(node.id)); newIds++;
          const price = Number(node.price?.current);
          if (Number.isFinite(price) && price > 0) cheapest = Math.min(cheapest ?? Infinity, price);
          if (!matches(node)) continue;
          if (items.has(String(node.id)) || pendingItems.some(item => item.id === `enjoei-${node.id}`)) continue;
          const item = {
            id: `enjoei-${node.id}`, url: `https://www.enjoei.com.br/p/${node.path}`,
            title: node.title.name, brand: node.brand?.displayable_name ?? null,
            source: 'Enjoei', term, size: '40', price_brl: price,
            store_name: node.store?.displayable?.name ?? null,
            department: node.categories?.department?.slug ?? null, category: node.categories?.sub_category?.slug ?? null,
          };
          let evidence = normalizeMonitorText(item.title);
          let checkedAt = null;
          let scopeConfirmed = Boolean(item.department && item.category);
          if (!/\b(?:jeans|denim)\b/.test(evidence)
              && /\b(?:sarja|linho|la fria|alfaiataria|calca social)\b/.test(evidence)) continue;
          if (!/\b(?:jeans|denim)\b/.test(evidence) || !scopeConfirmed) {
            const cached = detailCache[item.id];
            if (cached?.title === item.title && cached?.price_brl === item.price_brl
                && Date.now() - Date.parse(cached.checked_at) < 12 * 3600_000) {
              evidence += ` ${cached.text}`; checkedAt = cached.checked_at;
              scopeConfirmed = cached.scope_confirmed === true;
            } else if (detailReads < 8) {
              detailReads++;
              try {
                const response = await fetch(`https://pages.enjoei.com.br/products/${node.id}/v2.json`, { signal: AbortSignal.timeout(15000) });
                if (!response.ok) throw new Error(`Detalhe HTTP ${response.status}`);
                const product = await response.json();
                if (String(product.id ?? node.id) !== String(node.id)) throw new Error('Detalhe de outro anúncio');
                const category = product.category_slug ?? product.categories?.slug ?? '';
                if (category && !/^(?:masculino|rapazes)-roupas-calcas(?:-|$)/.test(category)) continue;
                if (product.size && String(product.size) !== '40') continue;
                if (product.fallback_pricing?.state && product.fallback_pricing.state !== 'published') continue;
                scopeConfirmed = /^(?:masculino|rapazes)-roupas-calcas(?:-|$)/.test(category) && String(product.size) === '40';
                const text = normalizeMonitorText(`${product.title ?? ''} ${product.description ?? ''}`).slice(0,12000);
                checkedAt = new Date().toISOString();
                detailCache[item.id] = { title: item.title, price_brl: item.price_brl, checked_at: checkedAt, text, scope_confirmed: scopeConfirmed };
                evidence += ` ${text}`;
              } catch (error) { item.detail_error = error.message; }
              await new Promise(resolve => setTimeout(resolve, 350));
            }
          }
          item.denim_validation = { state: scopeConfirmed && /\b(?:jeans|denim)\b/.test(evidence) ? 'confirmed' : 'pending', description_checked_at: checkedAt };
          if (/\bnao (?:e |eh )?(?:jeans|denim)\b/.test(evidence)) continue;
          if (item.denim_validation.state === 'confirmed') items.set(String(node.id), item);
          else pendingItems.push({ ...item, reason: 'Falta confirmar jeans/denim, categoria masculina ou tamanho na ficha; fora dos alertas de ofertas válidas' });
        }
        scanned += edges.length;
        const total = products.total == null ? null : Number(products.total);
        totalPages++;
        if (!edges.length || products.pageInfo?.hasNextPage === false
          || (Number.isFinite(total) && seenIds.size >= total)) {
          queryComplete = true;
          break;
        }
        const next = products.pageInfo?.endCursor ?? edges.at(-1)?.cursor;
        if (!newIds || !next || next === after) throw new Error('Paginação não avançou; cobertura incompleta');
        after = next;
        await new Promise(resolve => setTimeout(resolve, 400));
      }
      if (!queryComplete) throw new Error(`Limite de 10 páginas para ${queryTerm}; cobertura incompleta`);
      if (queryTerm !== searchTerms.at(-1)) await new Promise(resolve => setTimeout(resolve, 400));
    }
    await writeJsonAtomic(detailCachePath, Object.fromEntries(Object.entries(detailCache)
      .sort((a,b) => Date.parse(b[1].checked_at) - Date.parse(a[1].checked_at)).slice(0,500)), { validate: null });
    return { items: [...items.values()], pendingItems, scanned, cheapest, pages: totalPages, detailReads };
  }

  async function main() {
    if (process.argv.includes('--skip-enjoei') || process.env.SKIP_ENJOEI === '1') return;
    const started = new Date();
    const { snapshot: previous } = await readLatestValidSnapshot(dataDir);
    let result = { items: [], pendingItems: [], scanned: 0, cheapest: null, pages: 0, detailReads: 0 };
    let error = null;
    try { result = await collect(); } catch (cause) { error = cause.message; }
    const now = new Date();
    const snapshot = mergeMonitorSnapshot({
      previousSnapshot: previous, collected: result.items, now,
      run: { id, label, started_at: started.toISOString(), completed_at: now.toISOString(),
        partial: Boolean(error), errors: error ? [error] : [], scanned_count: result.scanned, pages: result.pages },
      filters: { brand: brandName, material: 'jeans/denim', department: 'masculino', category: 'calcas', size: '40', search_terms: searchTerms, ...(inclusive ? { price_max_inclusive_brl: maxPrice } : { price_max_exclusive_brl: maxPrice }), search_url: searchUrl },
      configuredCoverage: coverage, scheduledCoverage: coverage,
      successfulCoverage: error ? [] : coverage, failedCoverage: error ? coverage : [],
      itemCoverage: () => coverage,
    });
    snapshot.pending_items = result.pendingItems;
    snapshot.run.detail_reads = result.detailReads;
    const changes = buildMonitorChanges(previous, snapshot, { reactivationIsNew: false });
    const newIds = new Set(changes.newItems.map(item => item.id));
    const active = snapshot.items.filter(item => item.status === 'active');
    const lines = [
      `# Monitor ${label} — ${now.toISOString().slice(0, 10)}`, '',
      '## Resumo executivo', `- Filtro: jeans masculinos ${brandName} · tamanho 40 · ${priceLabel} (sem frete/taxas).`,
      `- Novos produtos: **${changes.newItems.length}**`,
      `- Alterações de preço: **${changes.priceChanges.length}**`,
      `- Já vistos e ativos: **${active.filter(item => !newIds.has(item.id)).length}**`,
      `- Anúncios examinados: **${result.scanned}**`, `- Cobertura parcial: **${error ? 'sim' : 'não'}**`,
    ];
    if (error) lines.push(`- Erros de coleta: ${error}`);
    if (!error && !active.length && result.cheapest != null) lines.push(`- Menor preço na busca-base: R$ ${money(result.cheapest)} (pode incluir marcas aproximadas).`);
    const section = (heading, items) => {
      lines.push('', heading);
      lines.push(...(items.length ? [...items].sort((a, b) => a.price_brl - b.price_brl).map(item =>
        `- R$ ${money(item.price_brl)} — [Enjoei] ${item.title} — tam. ${item.size} — ${item.url}${item.reason ? ` — Pendente: ${item.reason}` : ''}`) : ['- Nenhum.']));
    };
    section('## Novos produtos', changes.newItems);
    lines.push('', '## Mudanças de preço');
    for (const item of changes.priceChanges) lines.push(`- R$ ${money(item.previous_price_brl)} → R$ ${money(item.price_brl)} — ${item.title} — ${item.url}`);
    if (!changes.priceChanges.length) lines.push('- Nenhuma.');
    section('## Já vistos e ativos', active.filter(item => !newIds.has(item.id)));
    section('## Candidatos pendentes de conferência', result.pendingItems);
    lines.push('- Pendentes não entram nos alertas: falta confirmação de tecido jeans/denim.');
    const committed = await commitMonitorRun(dataDir, {
      runId: now.toISOString().replace(/[:.]/g, '-'), snapshot, report: lines.join('\n'),
      metadata: { source: id, collected_count: result.items.length, pending_count: result.pendingItems.length, failed_term_count: error ? 1 : 0 },
    });
    console.log(`${brandName} jeans 40: ${result.scanned} anúncios examinados; ${result.items.length} elegíveis (${priceLabel}). Relatório: ${committed.legacyReportPath}`);
    if (error) { console.error(error); process.exitCode = 1; }
  }

  return main();
}
