import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMonitorChanges, mergeMonitorSnapshot, normalizeMonitorText } from './lib/monitor-core.mjs';
import { commitMonitorRun, readLatestValidSnapshot } from './lib/monitor-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.ENJOEI_ZEGNA_DATA_DIR ?? path.join(root, 'data', 'enjoei-zegna');
const coverage = ['Enjoei:zegna'];
const searchUrl = 'https://www.enjoei.com.br/zegna/s?q=zegna&st%5Bsw%5D=40&dep=masculino&cat=masculino-roupas&sub=masculino-roupas-calcas';
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
    && Number(price) > 0 && Number(price) < 250
    && /\bzegna(?:sport)?\b/.test(text) && size40
    && ['masculino', 'rapazes'].includes(department)
    && ['masculino-roupas-calcas', 'rapazes-roupas-calcas'].includes(category);
}

async function collect() {
  const items = new Map();
  const seenIds = new Set();
  let after = null;
  let scanned = 0;
  let cheapest = null;
  const session = `codex-zegna-${Date.now()}`;
  for (let page = 0; page < 10; page++) {
    const url = new URL('https://enjusearch.enjoei.com.br/graphql-search-x');
    for (const [key, value] of Object.entries({
      browser_id: session, search_id: session, operation_name: 'searchProducts',
      query_id: 'c5faa5f85fb47bf0beaa97b67d8a9189', search_context: 'products_search',
      first: '30', term: 'zegna', shipping_range: 'same_country',
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
      items.set(String(node.id), {
        id: `enjoei-${node.id}`, url: `https://www.enjoei.com.br/p/${node.path}`,
        title: node.title.name, brand: node.brand?.displayable_name ?? null,
        source: 'Enjoei', term: 'zegna', size: '40', price_brl: price,
        store_name: node.store?.displayable?.name ?? null,
        department: node.categories.department.slug, category: node.categories.sub_category.slug,
      });
    }
    scanned += edges.length;
    const total = products.total == null ? null : Number(products.total);
    if (!edges.length || products.pageInfo?.hasNextPage === false
      || (Number.isFinite(total) && seenIds.size >= total)) {
      return { items: [...items.values()], scanned, cheapest, pages: page + 1 };
    }
    const next = products.pageInfo?.endCursor ?? edges.at(-1)?.cursor;
    if (!newIds || !next || next === after) throw new Error('Paginação não avançou; cobertura incompleta');
    after = next;
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error('Limite de 10 páginas; cobertura incompleta');
}

async function main() {
  if (process.argv.includes('--skip-enjoei') || process.env.SKIP_ENJOEI === '1') return;
  const started = new Date();
  const { snapshot: previous } = await readLatestValidSnapshot(dataDir);
  let result = { items: [], scanned: 0, cheapest: null, pages: 0 };
  let error = null;
  try { result = await collect(); } catch (cause) { error = cause.message; }
  const now = new Date();
  const snapshot = mergeMonitorSnapshot({
    previousSnapshot: previous, collected: result.items, now,
    run: { id: 'enjoei-zegna', label: 'Enjoei Calças Zegna 40', started_at: started.toISOString(), completed_at: now.toISOString(),
      partial: Boolean(error), errors: error ? [error] : [], scanned_count: result.scanned, pages: result.pages },
    filters: { brand: 'Zegna', department: 'masculino', category: 'calcas', size: '40', price_max_exclusive_brl: 250, search_url: searchUrl },
    configuredCoverage: coverage, scheduledCoverage: coverage,
    successfulCoverage: error ? [] : coverage, failedCoverage: error ? coverage : [],
    itemCoverage: () => coverage,
  });
  const changes = buildMonitorChanges(previous, snapshot, { reactivationIsNew: false });
  const newIds = new Set(changes.newItems.map(item => item.id));
  const active = snapshot.items.filter(item => item.status === 'active');
  const lines = [
    `# Monitor Enjoei Calças Zegna 40 — ${now.toISOString().slice(0, 10)}`, '',
    '## Resumo executivo', '- Filtro: calças masculinas Zegna · tamanho 40 · preço menor que R$ 250,00 (sem frete/taxas).',
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
      `- R$ ${money(item.price_brl)} — [Enjoei] ${item.title} — tam. ${item.size} — ${item.url}`) : ['- Nenhum.']));
  };
  section('## Novos produtos', changes.newItems);
  lines.push('', '## Mudanças de preço');
  for (const item of changes.priceChanges) lines.push(`- R$ ${money(item.previous_price_brl)} → R$ ${money(item.price_brl)} — ${item.title} — ${item.url}`);
  if (!changes.priceChanges.length) lines.push('- Nenhuma.');
  section('## Já vistos e ativos', active.filter(item => !newIds.has(item.id)));
  const committed = await commitMonitorRun(dataDir, {
    runId: now.toISOString().replace(/[:.]/g, '-'), snapshot, report: lines.join('\n'),
    metadata: { source: 'enjoei-zegna', collected_count: result.items.length, failed_term_count: error ? 1 : 0 },
  });
  console.log(`Zegna 40: ${result.scanned} anúncios examinados; ${result.items.length} abaixo de R$ 250. Relatório: ${committed.legacyReportPath}`);
  if (error) { console.error(error); process.exitCode = 1; }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
