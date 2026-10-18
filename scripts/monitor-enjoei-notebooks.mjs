import { setMonitorExit } from './lib/monitor-outcome.mjs';
import { meetsNotebookRamMinimum, NOTEBOOK_MIN_RAM_GB, NOTEBOOK_POLICY_VERSION, NOTEBOOK_PRIORITY_CPUS, assessNotebook, isEligibleNotebook, extractNotebookRamText, notebookExclusionReason, hasExplicitOtherNotebookCpu } from './lib/notebook-policy.mjs';
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractCpuLabel, extractGpuLabel, extractRamGb, extractStorageGb, textContainsCpuTerm } from "./lib/parsers.mjs";
import { mergeMonitorSnapshot } from "./lib/monitor-core.mjs";
import { DEFAULT_CPU_TERMS, cpuSearchQuery } from "./lib/cpu-terms.mjs";
import { commitMonitorRun, readLatestValidSnapshot, writeJsonAtomic } from "./lib/monitor-runtime.mjs";
import { collectEnjoeiPages } from "./lib/enjoei-pagination.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const automationRoot =
  process.env.ENJOEI_NOTEBOOKS_DATA_DIR ??
  path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".codex", "automations", "monitor-enjoei-notebooks");

const SEARCH_ENDPOINT = "https://enjusearch.enjoei.com.br/graphql-search-x";
const SITE_ORIGIN = "https://www.enjoei.com.br";


const EXCLUDE_PATTERNS = [
  "tênis", "tenis", "sandália", "sandalia", "sapato", "chinelo",
  "camiseta", "camisa", "calça", "bermuda", "vestido", "blusa",
  "jaqueta", "casaco", "mochila", "mala",
  "processador avulso", "placa-mãe", "placa mae", "motherboard",
  "sucata", "defeito", "quebrado", "não liga", "nao liga",
];

const PRICE_MIN_BRL = 1500;
const PRICE_MAX_BRL = 8000;

const args = process.argv.slice(2);
const shippingRange = getOptionValue(args, "--shipping-range") ?? "same_country";
const state = getOptionValue(args, "--state") ?? "pr";
const city = getOptionValue(args, "--city") ?? "curitiba";
const first = Number(getOptionValue(args, "--first") ?? 30);
const detailMax = Number(getOptionValue(args, "--detail-max") ?? process.env.ENJOEI_DETAIL_MAX ?? 8);
const maxPages = Number(getOptionValue(args, "--max-pages") ?? process.env.ENJOEI_NOTEBOOKS_MAX_PAGES ?? 24);
const maxMinutes = Number(getOptionValue(args, "--max-minutes") ?? process.env.ENJOEI_NOTEBOOKS_MAX_MINUTES ?? 2);
const maxPriceBrl = Number(getOptionValue(args, "--max-price") ?? PRICE_MAX_BRL);
const minPriceBrl = Number(getOptionValue(args, "--min-price") ?? PRICE_MIN_BRL);
const cpuArg = getOptionValue(args, "--cpu");
let terms = cpuArg
  ? cpuArg.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  : DEFAULT_CPU_TERMS;
const progressPath = path.join(automationRoot, "collection-progress.json");

// "notebook" makes this fuzzy query expand to tens of thousands of unrelated
// notebooks. Keep CPU context; validate actual models in title/description.
function enjoeiCpuQuery(term) {
  return term === "aimax395" ? "ryzen ai max 395" : cpuSearchQuery(term);
}

// Só executa quando rodado diretamente (node monitor-enjoei-notebooks.mjs).
// Importado por testes, NÃO dispara a coleta de rede.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(`\nFalha: ${formatError(error)}`);
    process.exitCode = 1;
  });
}

function formatError(error) {
  if (!error) return "Erro desconhecido.";
  const message = error.stack || error.message || String(error);
  const cause = error.cause;
  if (!cause) return message;
  return `${message}\nCausa: ${cause.stack || cause.message || String(cause)}`;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  if (!Number.isInteger(first) || first < 1 || first > 30) throw new Error("--first deve estar entre 1 e 30 (paginação usa o cursor real da API)");
  if (!Number.isInteger(maxPages) || maxPages < 1 || !Number.isFinite(maxMinutes) || maxMinutes <= 0
    || !Number.isInteger(detailMax) || detailMax < 1) throw new Error("Limites de páginas, minutos e detalhes devem ser positivos");
  if (!terms.length || terms.some((term) => !DEFAULT_CPU_TERMS.includes(term))) throw new Error("Lista de CPUs vazia ou desconhecida");
  if (!Number.isFinite(minPriceBrl) || !Number.isFinite(maxPriceBrl) || minPriceBrl < 0 || maxPriceBrl < minPriceBrl) throw new Error("Faixa de preço inválida");
  const now = new Date();
  const runDate = now.toISOString().slice(0, 10);
  const runTimestamp = now.toISOString();
  const runId = runTimestamp.replace(/[:.]/g, "-");

  const previousSnapshotResult = await readLatestValidSnapshot(automationRoot);
  const previousSnapshotPath = previousSnapshotResult.file ? path.join(automationRoot, previousSnapshotResult.file) : null;
  const previousSnapshot = previousSnapshotResult.snapshot;

  console.log(`Execução Enjoei Notebooks: ${runTimestamp}`);
  console.log(`Termos: ${terms.join(", ")}`);
  console.log(`Faixa: R$ ${minPriceBrl}–R$ ${maxPriceBrl}`);
  console.log(`Snapshot anterior: ${previousSnapshotPath ?? "(nenhum)"}\n`);

  const { items: collected, failedTerms, successfulTerms, incompleteTerms, progress, stats, rejectedIds } = await collectProducts(previousSnapshot);
  const snapshot = mergeEnjoeiNotebookSnapshot({
    runDate, collected, previousSnapshot,
    now: new Date(),
    scheduledTerms: terms, successfulTerms, failedTerms, incompleteTerms,
    configuredTerms: DEFAULT_CPU_TERMS,
    priceMin: minPriceBrl, priceMax: maxPriceBrl,
  });
  snapshot.run.started_at = runTimestamp;
  snapshot.run.completed_at = new Date().toISOString();
  snapshot.run.collection_started_at = progress.started_at;
  snapshot.run.discovery = stats;
  snapshot.pending_items = progress.pending_items;
  snapshot.items = snapshot.items.map(item => rejectedIds.includes(item.id) ? { ...item, status: 'out_of_scope' } : item);
  snapshot.run.pagination = Object.fromEntries(terms.map((term) => [term, {
    pages: progress.terms[term].pages ?? 0,
    complete: Boolean(progress.terms[term].complete),
    next_cursor: progress.terms[term].complete ? null : progress.terms[term].after ?? null,
    pending_details: progress.pending_items.filter((item) => (item.search_terms ?? item.cpu_terms)?.includes(term)).length,
    reason: progress.terms[term].last_error ?? null,
  }]));
  backfillSpecsFromTitle(snapshot);
  verifyCarriedItems(snapshot);

  const report = buildReport({ runDate, snapshot, previousSnapshot, failedTerms, incompleteTerms });
  const committed = await commitMonitorRun(automationRoot, {
    runId,
    snapshot,
    report,
    metadata: { source: "enjoei-notebooks", collected_count: collected.length, failed_term_count: failedTerms.length,
      incomplete_term_count: incompleteTerms.length, collection_started_at: progress.started_at },
  });
  // Keep the checkpoint until publication has succeeded. A crash before this
  // write retries the same cycle instead of losing its findings.
  progress.completed = !committed.snapshot.run.partial;
  await saveCollectionProgress(progress);
  const snapshotPath = committed.legacySnapshotPath;
  const reportPath = committed.legacyReportPath;

  console.log(`Coletados: ${collected.length} | Snapshot: ${snapshotPath}`);
  console.log(`Relatório: ${reportPath}`);
  if (committed.invalidItems.length) console.warn(`${committed.invalidItems.length} item(ns) foram para a quarentena.`);

  // Falha total: TODOS os termos lançaram erro (nada coletado). Preservamos o
  // snapshot anterior (o merge já mantém os itens), mas saímos com código != 0
  // para o orquestrador e o GitHub Actions detectarem a falha.
  if (failedTerms.length === terms.length) {
    console.error("Falha total: nenhum termo do Enjoei Notebooks foi coletado nesta rodada; snapshot anterior preservado.");
    setMonitorExit(committed.snapshot.run);
  } else if (committed.snapshot.run.partial) {
    console.error(`Coleta incompleta Enjoei Notebooks: ${failedTerms.length} termo(s) com falha; ${incompleteTerms.length} com páginas ou detalhes pendentes. Progresso salvo para a próxima rodada.`);
    setMonitorExit(committed.snapshot.run);
  }
}

// ── coleta ───────────────────────────────────────────────────────────────────

async function collectProducts(previousSnapshot) {
  const progress = await loadCollectionProgress();
  const now = Date.now(), deadline = now + maxMinutes * 60_000;
  const cachePath = path.join(automationRoot, 'notebook-detail-cache.json');
  let cache = {};
  try { cache = JSON.parse(await fs.readFile(cachePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const due = term => cpuArg || NOTEBOOK_PRIORITY_CPUS.includes(term) || !progress.terms[term].complete
    || !progress.terms[term].completed_at || now - Date.parse(progress.terms[term].completed_at) >= 24 * 3600_000;
  terms = terms.filter(due).sort((a,b) => Number(!NOTEBOOK_PRIORITY_CPUS.includes(a)) - Number(!NOTEBOOK_PRIORITY_CPUS.includes(b))
    || (Date.parse(progress.terms[a].completed_at) || 0) - (Date.parse(progress.terms[b].completed_at) || 0));
  const pending = new Map(progress.pending_items.map(item => [item.id, item]));
  const verified = new Map();
  const rejectedIds = [], failedTerms = [], successfulTerms = [], incompleteTerms = [];
  const stats = { search_requests: 0, detail_requests: 0, retries: 0, cache_hits: 0, page_budget: maxPages, detail_budget: detailMax, query_yield: {} };
  const checkpoint = async () => {
    progress.pending_items = [...pending.values()];
    progress.verified_items = [];
    await saveCollectionProgress(progress);
  };
  for (const term of terms) {
    let cursor = progress.terms[term];
    if (cursor.complete || Date.now() - Date.parse(cursor.started_at ?? progress.started_at) > 7 * 86400_000) {
      cursor = progress.terms[term] = { started_at: new Date().toISOString(), completed_at: cursor.completed_at, after: null, pages: 0, complete: false, seen_ids: [] };
    }
    cursor.seen_ids ??= [];
    const pagesBefore = stats.search_requests;
    console.log(`Termo: ${term}${cursor.pages ? ` — retomando após ${cursor.pages} página(s)` : ''}`);
    try {
      const result = await collectEnjoeiPages({ progress: cursor, deadline, checkpoint,
        maxPages: Math.max(0, Math.min(4, maxPages - stats.search_requests)),
        fetchPage: async after => {
          const response = await fetchWithRetry(buildApiUrl(term, after, progress.session_id), {
            headers: { accept: 'application/json', origin: SITE_ORIGIN }, deadline,
            beforeAttempt: () => { if (stats.search_requests >= maxPages) throw new Error('Limite global de páginas atingido'); stats.search_requests++; },
            onRetry: () => stats.retries++,
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          if (payload.errors?.length) throw new Error('API retornou erros GraphQL');
          const products = payload?.data?.search?.products;
          if (!Array.isArray(products?.edges)) throw new Error('Resposta sem produtos');
          const ids = new Set([...cursor.seen_ids, ...products.edges.map(edge => String(edge.node?.id))]);
          if (Number(products.total) > 0 && ids.size >= Number(products.total)) products.pageInfo = { ...products.pageInfo, hasNextPage: false };
          return products;
        },
        onPage: async edges => {
          for (const edge of edges) {
            if (edge.node?.id) cursor.seen_ids.push(String(edge.node.id));
            const item = normalizeProduct(edge.node, term);
            if (!item) continue;
            if (hasExcludedKeyword(item.title) || hasExplicitOtherNotebookCpu(item.title) || (item.ram_gb != null && item.ram_gb < NOTEBOOK_MIN_RAM_GB)) {
              rejectedIds.push(item.id); pending.delete(item.id); continue;
            }
            if (item.price_brl < minPriceBrl || item.price_brl > maxPriceBrl || !itemMatchesCpuTerm(item, term)) continue;
            const existing = pending.get(item.id);
            pending.set(item.id, { ...item, search_terms: [...new Set([...(existing?.search_terms ?? []), term])] });
          }
          cursor.seen_ids = [...new Set(cursor.seen_ids)];
        },
      });
      if (result.complete) { cursor.completed_at = new Date().toISOString(); successfulTerms.push(term); }
      else incompleteTerms.push(term);
    } catch (error) {
      cursor.last_error = error.message;
      if (/limite|prazo/i.test(error.message)) incompleteTerms.push(term);
      else failedTerms.push(term);
      console.warn(`${term}: ${error.message}`);
    }
    stats.query_yield[term] = { search_requests: stats.search_requests - pagesBefore };
    await checkpoint();
    if (Date.now() < deadline) await sleep(400);
  }
  await enrichMissingDetails([...pending.values()].sort((a,b) => Number(!a.search_terms?.some(t => NOTEBOOK_PRIORITY_CPUS.includes(t))) - Number(!b.search_terms?.some(t => NOTEBOOK_PRIORITY_CPUS.includes(t)))), previousSnapshot, {
    cache, deadline, stats,
    onResolution: async (item, outcome, confirmed) => {
      if (confirmed) verified.set(confirmed.id, confirmed);
      if (outcome === 'rejected') { verified.delete(item.id); rejectedIds.push(item.id); }
      if (outcome === 'pending') pending.set(item.id, item);
      else pending.delete(item.id);
      await checkpoint();
    },
  });
  for (const item of pending.values()) if (!item.details_checked_at || item.detail_error) {
    for (const term of item.search_terms ?? item.cpu_terms ?? []) if (terms.includes(term) && !incompleteTerms.includes(term)) incompleteTerms.push(term);
  }
  for (const [term, metrics] of Object.entries(stats.query_yield)) {
    const hits = [...verified.values()].filter(item => item.search_terms?.includes(term));
    metrics.confirmed = hits.length;
    metrics.exclusive_this_run = hits.filter(item => item.search_terms.length === 1).length;
  }
  await writeJsonAtomic(cachePath, Object.fromEntries(Object.entries(cache).sort((a,b) => Date.parse(b[1].checked_at)-Date.parse(a[1].checked_at)).slice(0,1000)), { validate: null });
  await checkpoint();
  return { items: [...verified.values()], failedTerms, successfulTerms, incompleteTerms, progress, stats, rejectedIds };
}

async function loadCollectionProgress() {
  const filters = { first, shippingRange, state, city, minPriceBrl, maxPriceBrl };
  let saved;
  try { saved = JSON.parse(await fs.readFile(progressPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let old = {};
  try { old = JSON.parse(saved?.configuration ?? '{}'); } catch {}
  const compatible = Object.entries(filters).every(([key,value]) => old[key] === value);
  const started = new Date().toISOString();
  const progress = compatible ? saved : { started_at: started, session_id: `codex-notebooks-${Date.now()}`, terms: {}, pending_items: [], verified_items: [] };
  progress.schema_version = 2;
  progress.configuration = JSON.stringify(filters);
  for (const key of Object.keys(progress.terms)) if (!DEFAULT_CPU_TERMS.includes(key)) delete progress.terms[key];
  for (const term of DEFAULT_CPU_TERMS) {
    progress.terms[term] ??= { after: null, pages: 0, complete: false, started_at: started, seen_ids: [] };
    if (progress.terms[term].complete) progress.terms[term].completed_at ??= progress.updated_at;
  }
  progress.pending_items = (progress.pending_items ?? []).filter(item => !hasExplicitOtherNotebookCpu(item.title ?? ''));
  return progress;
}

async function saveCollectionProgress(progress) {
  progress.updated_at = new Date().toISOString();
  await writeJsonAtomic(progressPath, progress, { validate: null });
}

// Legacy one-page heuristic, retained for existing callers. Production follows
// actual cursors through collectEnjoeiPages; page length is not proof of the end.
export function isTruncatedPage(products, first) {
  const edges = products?.edges ?? [];
  return Boolean(products?.pageInfo?.hasNextPage) || edges.length >= first;
}

async function fetchWithRetry(url, options = {}) {
  const { deadline = Infinity, beforeAttempt = () => {}, onRetry = () => {}, ...request } = options;
  let lastError;
  for (let i = 0; i < 3; i++) {
    if (Date.now() >= deadline) throw new Error('Prazo global da coleta atingido');
    beforeAttempt();
    try { return await fetch(url, { ...request, signal: AbortSignal.timeout(Math.max(1, Math.min(20000, deadline - Date.now()))) }); }
    catch (error) {
      lastError = error;
      if (i < 2 && Date.now() + 750*(i+1) < deadline) { onRetry(); await sleep(750*(i+1)); }
      else break;
    }
  }
  throw lastError;
}

// ── API ──────────────────────────────────────────────────────────────────────

function buildApiUrl(term, after = null, sessionId = `codex-notebooks-${Date.now()}`) {
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("browser_id", sessionId);
  url.searchParams.set("city", city);
  url.searchParams.set("experienced_seller", "true");
  url.searchParams.set("first", String(first));
  url.searchParams.set("operation_name", "searchProducts");
  url.searchParams.set("query_id", "c5faa5f85fb47bf0beaa97b67d8a9189");
  url.searchParams.set("search_context", "products_search");
  url.searchParams.set("search_id", sessionId);
  url.searchParams.set("shipping_range", shippingRange);
  url.searchParams.set("state", state);
  url.searchParams.set("term", enjoeiCpuQuery(term));
  if (after != null) url.searchParams.set("after", after);
  // sem size_types.shoes nem department — busca geral
  return url;
}

function buildSearchPageUrl(term) {
  const query = enjoeiCpuQuery(term);
  const url = new URL(`${SITE_ORIGIN}/${encodeURIComponent(query)}/s`);
  url.searchParams.set("ref", "products_search");
  url.searchParams.set("q", query);
  return url.toString();
}

// ── normalização ─────────────────────────────────────────────────────────────

function normalizeProduct(node, cpuTerm) {
  if (!node?.id || !node?.path) return null;
  const price = Number(node.price?.current);
  const title = node.title?.name ?? "";
  return {
    id: String(node.id),
    url: `${SITE_ORIGIN}/p/${node.path}`,
    title,
    brand: node.brand?.displayable_name ?? null,
    price_brl: Number.isFinite(price) ? price : null,
    original_price_brl: Number.isFinite(Number(node.price?.original)) ? Number(node.price.original) : null,
    cpu: extractCpuLabel(title),
    ram_gb: extractNotebookRamText(title),
    storage_gb: extractStorageGb(title),
    used: Boolean(node.used),
    shipping_free: Boolean(node.shipping?.free),
    store_name: node.store?.displayable?.name ?? null,
    cpu_terms: [cpuTerm],
    search_terms: [cpuTerm],
    status: "active",
    first_seen: null,
    last_seen: null,
  };
}

function itemMatchesCpuTerm(item, term) {
  if (textContainsCpuTerm(`${item.title} ${item.brand ?? ""}`, term)) return true;
  // Enjoei's search index may match the CPU in hidden/details text while the
  // API returns only a short title. Trust that signal only for clear notebook
  // listings to avoid unrelated hits such as lamps or clothes.
  return isLikelyNotebookSearchHit(item);
}

function hasExcludedKeyword(text) {
  const n = (text ?? "").toLowerCase();
  return Boolean(notebookExclusionReason(text)) || EXCLUDE_PATTERNS.filter(p => !['sucata','defeito','quebrado','não liga','nao liga'].includes(p)).some((p) => n.includes(p));
}

function isLikelyNotebookSearchHit(item) {
  const text = `${item.title ?? ""} ${item.brand ?? ""}`.toLowerCase();
  if (/\b(macbook|apple|ipad|iphone|imac)\b/i.test(text)) return false;
  return /\b(notebook|laptop|elitebook|thinkpad|ideapad|vivobook|zenbook|galaxy book|book4|rog|alienware|predator|legion|loq|tuf|aspire|inspiron|latitude|dell g15|avell\s+(?:a\d+|storm)|nave\s+estelar|msi\s+(?:raider|vector|titan))\b/i.test(text);
}

// ── snapshot ─────────────────────────────────────────────────────────────────

function someTermIn(text, cpuTerms) {
  return cpuTerms.some((t) => textContainsCpuTerm(text, t));
}

// Enriquece com detalhes do anúncio e confirma o CPU. Distingue:
//  - termo confirmado na evidência → mantém com o(s) termo(s) corretos;
//  - mismatch CONCLUSIVO (buscamos a descrição e mesmo assim nada confere) → descarta;
//  - inconclusivo TEMPORÁRIO (fetch falhou OU orçamento de detalhes esgotado) →
//    preserva evidência da política atual por até 24h, com CPU/RAM confirmadas e
//    título/marca/preço iguais; a nova leitura continua pendente na fila.
// fetchDetails/detailMax/cpuTerms são injetáveis para teste.
export async function enrichMissingDetails(items, previousSnapshot, {
  fetchDetails = fetchProductDetails, detailMax: maxDetails = detailMax, cpuTerms = DEFAULT_CPU_TERMS,
  onResolution = async () => {}, cache = {}, deadline = Infinity, stats = {},
} = {}) {
  const verified = [];
  let opened = 0;
  for (const item of items) {
    const cached = cache[item.id];
    const reusable = cached?.title === item.title && cached?.brand === item.brand
      && cached.version === NOTEBOOK_POLICY_VERSION && Date.now() - Date.parse(cached.checked_at) < 24*3600_000;
    let details = reusable ? cached.details : null;
    if (reusable) stats.cache_hits = (stats.cache_hits ?? 0) + 1;
    if (!details && opened < maxDetails && Date.now() < deadline) {
      opened++;
      try {
        details = await fetchDetails(item, { deadline, stats });
        if (details) cache[item.id] = { title: item.title, brand: item.brand, checked_at: new Date().toISOString(), version: NOTEBOOK_POLICY_VERSION, details };
      } catch (error) { item.detail_error = error.message; }
    }
    if (!details) {
      // A temporary detail failure must not erase a recently verified listing.
      // Search labels alone are not evidence of CPU or installed RAM.
      const previous = previousSnapshot?.items?.find(old => String(old.id) === String(item.id));
      const checkedAt = Date.parse(previous?.details_checked_at ?? '');
      const preserve = previous?.title === item.title && (previous.brand ?? '') === (item.brand ?? '')
        && Number(previous.price_brl) === Number(item.price_brl)
        && previous.notebook_validation?.version === NOTEBOOK_POLICY_VERSION
        && previous.notebook_validation?.state === 'validated'
        && Number.isFinite(checkedAt) && Date.now() - checkedAt >= 0 && Date.now() - checkedAt < 24*3600_000
        && isEligibleNotebook(previous)
        && previous.cpu_terms?.length === 1 && cpuTerms.includes(previous.cpu_terms[0]);
      const retained = preserve ? { ...previous, search_terms: [...new Set([...(previous.search_terms ?? []), ...(item.search_terms ?? [])])] } : null;
      if (retained) verified.push(retained);
      await onResolution(item, 'pending', retained);
      continue;
    }
    if (details.unavailable) { await onResolution(item, 'rejected', null); continue; }
    const merged = { ...item, detail_error: null, cpu: details.cpu ?? null, ram_gb: details.ram_gb ?? item.ram_gb ?? null,
      storage_gb: details.storage_gb ?? null, gpu: details.gpu ?? null,
      description_evidence: details.text ?? '', detail_title: details.title ?? null,
      details_checked_at: reusable ? cached.checked_at : new Date().toISOString() };
    const assessment = assessNotebook(merged, details.text ?? '');
    merged.notebook_validation = assessment;
    merged.cpu_terms = assessment.cpu_terms.filter(term => cpuTerms.includes(term));
    if (assessment.state === 'validated' && merged.cpu_terms.length === 1) {
      verified.push(merged); await onResolution(item, 'verified', merged);
    } else if (assessment.state === 'rejected') await onResolution(item, 'rejected', null);
    else { Object.assign(item, merged); await onResolution(item, 'pending', null); }
  }
  if (opened) console.log(`Detalhes Enjoei abertos: ${opened}`);
  return verified;
}

function needsProductDetails(item) { return item.cpu == null || item.ram_gb == null; }

async function fetchProductDetails(item, { deadline = Infinity, stats = {} } = {}) {
  const response = await fetchWithRetry(`https://pages.enjoei.com.br/products/${item.id}/v2.json`, {
    deadline, beforeAttempt: () => { stats.detail_requests = (stats.detail_requests ?? 0) + 1; },
    onRetry: () => { stats.retries = (stats.retries ?? 0) + 1; },
    headers: { accept: 'application/json' },
  });
  if ([404,410].includes(response.status)) return { unavailable: true };
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const product = await response.json();
  if (String(product.id) !== String(item.id)) throw new Error('Detalhe de outro produto ou identidade ausente');
  const text = `${product.title ?? ''}\n${product.description ?? ''}\n${product.brand?.name ?? ''}`;
  return { title: product.title, cpu: extractCpuLabel(text), ram_gb: extractNotebookRamText(text),
    storage_gb: extractStorageGb(text), gpu: extractGpuLabel(text), text };
}

// Reaproveita melhorias dos parsers em itens carregados de snapshots antigos.
// Itens "not_seen" sao copiados verbatim do snapshot anterior (lib/snapshot.mjs)
// e nao passam por normalizeProduct/enriquecimento, entao ficam com campos
// defasados — ex.: sem o campo cpu, que so foi adicionado depois, ou sem ram/ssd
// que um parser melhorado agora consegue extrair. Preenchemos a partir do TITULO
// apenas (puro, sem rede) e nunca sobrescrevemos dado ja existente. O que so
// existe na descricao (3 dos itens sem cpu) nao e recuperavel aqui de proposito:
// nao refazemos fetch de anuncios que sairam dos resultados.
function backfillSpecsFromTitle(snapshot) {
  for (const item of snapshot.items ?? []) {
    const title = item.title ?? "";
    if (item.cpu == null) { const v = extractCpuLabel(title); if (v != null) item.cpu = v; }
    if (item.ram_gb == null) { const v = extractNotebookRamText(title); if (v != null) item.ram_gb = v; }
    if (item.storage_gb == null) { const v = extractStorageGb(title); if (v != null) item.storage_gb = v; }
    if (item.gpu == null) { const v = extractGpuLabel(title); if (v != null) item.gpu = v; }
  }
}

// Itens "not_seen" são copiados verbatim do snapshot anterior e não passam pela
// verificação de CPU da coleta. Se vierem de um snapshot pré-fix, podem carregar
// termos errados (ex.: um notebook "pro max" marcado como aimax395 pela busca
// difusa). Aqui re-validamos os cpu_terms dos carregados contra título + marca +
// label de CPU já extraído (a descrição não está disponível aqui), descartando
// os que não confirmam nenhum termo. Itens ativos já foram verificados na coleta.
function verifyCarriedItems(snapshot) {
  snapshot.items = (snapshot.items ?? []).filter((item) => {
    if (item.status !== "not_seen") return true;
    const evidence = `${item.title ?? ""} ${item.brand ?? ""} ${item.cpu ?? ""}`;
    // Re-deriva os termos a partir da evidência (não só o termo da busca): um
    // anúncio devolvido por uma busca mas que na verdade é outra CPU da lista
    // recebe a etiqueta correta, em vez de ser descartado.
    const terms = DEFAULT_CPU_TERMS.filter((t) => textContainsCpuTerm(evidence, t));
    if (terms.length === 0) return false;
    item.cpu_terms = terms;
    return true;
  });
}

// Merge com cobertura por termo de CPU. Função pura (sem rede/I/O), exportada
// para teste de regressão.
//  - termo que FALHOU → seus itens não viram not_seen (preservados);
//  - termo TRUNCADO (incompleto) → idem (pode haver itens além da página);
//  - item com 2 termos, um ok e um falho → preservado;
//  - grava run.partial + contagens + coverage arrays.
export function mergeEnjoeiNotebookSnapshot({
  runDate,
  now = null,
  collected,
  previousSnapshot,
  scheduledTerms,
  configuredTerms = scheduledTerms,
  successfulTerms = [],
  failedTerms = [],
  incompleteTerms = [],
  priceMin,
  priceMax,
}) {
  const previousItems = (previousSnapshot?.items ?? []).filter(
    (i) => i.price_brl != null && i.price_brl >= priceMin && i.price_brl <= priceMax
  );
  // Termos truncados entram na cobertura FALHA (impede falsos not_seen). Seus
  // itens coletados continuam active (o merge sempre marca o coletado como active).
  const failedCoverage = [...new Set([...failedTerms, ...incompleteTerms])];
  const result = mergeMonitorSnapshot({
    previousSnapshot: previousSnapshot ? { ...previousSnapshot, items: previousItems } : null,
    collected,
    now: now instanceof Date ? now : new Date(`${runDate}T12:00:00Z`),
    run: {
      partial: failedCoverage.length > 0,
      successful_term_count: successfulTerms.length,
      failed_term_count: failedTerms.length,
      incomplete_term_count: incompleteTerms.length,
      incomplete_coverage: [...new Set(incompleteTerms)],
    },
    scheduledCoverage: scheduledTerms,
    successfulCoverage: successfulTerms,
    failedCoverage,
    configuredCoverage: configuredTerms,
    itemCoverage: (item) => item.search_terms ?? item.cpu_terms ?? [],
  });
  result.price_range_brl = { min: priceMin, max: priceMax };
  result.filters = { ...result.filters, ram_gb: { min: NOTEBOOK_MIN_RAM_GB }, price_brl: result.price_range_brl };
  return result;
}

// ── relatório ─────────────────────────────────────────────────────────────────

function buildReport({ runDate, snapshot, previousSnapshot, failedTerms = [], incompleteTerms = [] }) {
  const currentItems = snapshot.items.filter(
    (i) => isEligibleNotebook(i) && i.status === "active" && i.price_brl != null && i.price_brl >= minPriceBrl && i.price_brl <= maxPriceBrl
  );
  const previousItems = (previousSnapshot?.items ?? []).filter(
    (i) => isEligibleNotebook(i) && i.price_brl != null && i.price_brl >= minPriceBrl && i.price_brl <= maxPriceBrl
  );
  const previousById = new Map(previousItems.map((i) => [i.id ?? i.url, i]));
  const currentById = new Map(currentItems.map((i) => [i.id ?? i.url, i]));

  const newItems = currentItems.filter((i) => !previousById.has(i.id ?? i.url));
  const stillActive = currentItems.filter((i) => previousById.has(i.id ?? i.url));
  const notSeen = previousItems
    .filter((i) => i.status === "active")
    .filter((i) => !currentById.has(i.id ?? i.url));

  const priceChanges = [];
  for (const item of currentItems) {
    const prev = previousById.get(item.id ?? item.url);
    if (prev?.price_brl != null && item.price_brl != null && prev.price_brl !== item.price_brl) {
      priceChanges.push({ item, from: prev.price_brl, to: item.price_brl });
    }
  }

  const lines = [];
  lines.push(`# Monitor Enjoei notebooks por CPU — ${runDate}`);
  lines.push("");
  lines.push("## Resumo executivo");
  lines.push(`- RAM mínima instalada: **${NOTEBOOK_MIN_RAM_GB} GB**.`);
  lines.push(`- Novos notebooks (R$ ${fmtBrl(minPriceBrl)}–R$ ${fmtBrl(maxPriceBrl)}): **${newItems.length}**`);
  lines.push(`- Já vistos e ativos: **${stillActive.length}**`);
  lines.push(`- Não vistos nesta rodada: **${notSeen.length}**`);
  lines.push(`- Alterações de preço: **${priceChanges.length}**`);
  lines.push(`- Termos: ${terms.join(", ")}`);
  lines.push(`- Consultas de busca: **${snapshot.run?.discovery?.search_requests ?? 0}/${maxPages}**; fichas: **${snapshot.run?.discovery?.detail_requests ?? 0}**; cache: **${snapshot.run?.discovery?.cache_hits ?? 0}**.`);
  lines.push('- CPUs prioritárias a cada rodada; secundárias a cada 24h. Armazenamento desconhecido não impede a oferta.');
  if (snapshot.run?.partial) {
    lines.push(`- ⚠️ Cobertura parcial: ${failedTerms.length} com falha, ${incompleteTerms.length} com páginas/detalhes pendentes — itens desses termos foram preservados (não marcados como não vistos).`);
  }
  lines.push("");

  if (failedTerms.length || incompleteTerms.length) {
    lines.push("## Cobertura incompleta");
    if (failedTerms.length) lines.push(`- Termos com falha: ${failedTerms.join(", ")}`);
    if (incompleteTerms.length) lines.push(`- Termos com páginas/detalhes pendentes (retomada automática na próxima rodada): ${incompleteTerms.join(", ")}`);
    lines.push("");
  }

  lines.push("## Progresso da busca");
  lines.push(`- Busca iniciada em: ${snapshot.run?.collection_started_at ?? "n/d"}`);
  for (const [term, progress] of Object.entries(snapshot.run?.pagination ?? {})) {
    lines.push(`- ${term}: ${progress.pages} página(s); ${progress.complete ? "paginação concluída" : "paginação pendente"}; ${progress.pending_details} descrição(ões) pendente(s)${progress.reason ? ` — ${progress.reason}` : ""}.`);
  }
  lines.push("");

  lines.push(`## Novos notebooks`);
  if (!newItems.length) {
    lines.push("- Nenhum.");
  } else {
    for (const item of sortByPrice(newItems)) lines.push(formatLine(item));
  }
  lines.push("");

  if (priceChanges.length) {
    lines.push("## Mudanças de preço");
    for (const c of priceChanges.sort((a, b) => a.to - b.to)) {
      lines.push(`- R$ ${fmtBrl(c.from)} → R$ ${fmtBrl(c.to)} — ${c.item.title} — ${c.item.url}`);
    }
    lines.push("");
  }

  lines.push("## Já vistos e ativos");
  if (!stillActive.length) {
    lines.push("- Nenhum.");
  } else {
    for (const item of sortByPrice(stillActive)) lines.push(formatLine(item));
  }
  lines.push("");

  if (notSeen.length) {
    lines.push("## Não vistos nesta rodada");
    lines.push("- Observação: ausência não garante remoção do anúncio.");
    for (const item of sortByPrice(notSeen)) lines.push(`- ${item.title} — ${item.url}`);
    lines.push("");
  }
  lines.push('## Candidatos pendentes de conferência');
  lines.push('- Não entram nos alertas de ofertas confirmadas.');
  for (const item of snapshot.pending_items ?? []) lines.push(`${formatLine(item)} — Pendente: ${(item.notebook_validation?.reasons ?? [item.detail_error ?? 'Descrição pendente']).join('; ')}`);
  lines.push('');

  return lines.join("\n");
}

function formatLine(item) {
  const ram = item.ram_gb ? `${item.ram_gb} GB RAM` : "RAM n/d";
  const sto = item.storage_gb ? `${item.storage_gb} GB` : "armazenamento n/d";
  const ship = item.shipping_free ? " — frete grátis" : "";
  const terms = item.cpu_terms?.length ? ` — cpu: ${item.cpu_terms.join(", ")}` : "";
  return `- R$ ${fmtBrl(item.price_brl)} — ${item.title} — ${ram} / ${sto}${ship}${terms} — ${item.url}`;
}

function sortByPrice(items) {
  return [...items].sort((a, b) => (a.price_brl ?? Infinity) - (b.price_brl ?? Infinity));
}

function fmtBrl(v) {
  if (v == null || !Number.isFinite(Number(v))) return "n/d";
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── utilitários ───────────────────────────────────────────────────────────────

async function getLatestSnapshotPath(root) {
  const entries = await fs.readdir(root).catch(() => []);
  const snapshots = entries
    .filter((n) => /^snapshot-.*\.json$/.test(n))
    .map((n) => path.join(root, n))
    .sort();
  return snapshots.at(-1) ?? null;
}

async function readJsonSafe(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, "utf8")); }
  catch { return null; }
}

function getOptionValue(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] ?? null;
}
