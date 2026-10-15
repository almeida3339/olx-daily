import { meetsNotebookRamMinimum, NOTEBOOK_MIN_RAM_GB, NOTEBOOK_POLICY_VERSION, assessNotebook, isEligibleNotebook, notebookRamGb } from './notebook-policy.mjs';
import { assessOledMonitor, isApprovedOledMonitor, classifySavedOledItem, OLED_POLICY_VERSION, OLED_DETAIL_TTL_MS } from './oled-monitor-scope.mjs';
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import {
  buildSearchUrl,
  collectSearchResults,
  detectPageState,
  extractMercadoLivreId,
  extractMercadoLivreNotebookSpecs,
  pageStateMessage,
  textMatchesTerm,
} from "./mercadolivre-monitor.mjs";
import {
  buildMonitorChanges,
  mergeMonitorSnapshot,
  normalizeMonitorText,
} from "./monitor-core.mjs";
import { classifyMonitorError, retryTransient } from "./monitor-errors.mjs";
import { createMonitorLogger } from "./monitor-logger.mjs";
import { commitMonitorRun, readLatestValidSnapshot, writeJsonAtomic } from "./monitor-runtime.mjs";

const NAVIGATION_TIMEOUT_MS = 45_000;
const LOCK_STALE_MS = 6 * 60 * 60 * 1000;

export async function runMercadoLivreBatch({
  id,
  label,
  dataDir,
  profileDir,
  terms,
  allTerms = terms,
  minPrice,
  maxPrice,
  displayMinPrice = minPrice,
  displayMaxPrice = maxPrice,
  searchOptions = {},
  excludeTerms = [],
  itemFilter = null,
  termMatcher = textMatchesTerm,
  kind = "product",
  relevantDetails = [],
}) {
  const args = process.argv.slice(2);
  const headless = args.includes("--headless");
  // Por padrão a janela roda FORA DA TELA (não atrapalha o trabalho), mantendo o
  // Chrome "real" (menos detectável que headless). --visible mostra a janela
  // (útil para login/desafios); --headless roda sem janela (mais leve, porém
  // mais sujeito a bloqueio do Mercado Livre).
  const visible = args.includes("--visible");
  const loadAssets = args.includes("--load-assets"); // não bloqueia imagens/mídia/fontes (diagnóstico)
  const maxItemsPerTerm = positiveNumber(option(args, "--max-items"), 20);
  const maxDetails = nonNegativeNumber(option(args, "--max-details"), kind === "notebook" ? 8 : 4);
  const delayMinMs = positiveNumber(option(args, "--delay-min-ms"), 12_000);
  const delayMaxMs = Math.max(delayMinMs, positiveNumber(option(args, "--delay-max-ms"), 22_000));
  const detailDelayMinMs = positiveNumber(option(args, "--detail-delay-min-ms"), 12_000);
  const detailDelayMaxMs = Math.max(detailDelayMinMs, positiveNumber(option(args, "--detail-delay-max-ms"), 22_000));
  const previousResult = await readLatestValidSnapshot(dataDir);
  const previous = previousResult.snapshot;
  const previousById = new Map((previous?.items ?? []).map((item) => [item.id, item]));
  const checkedProduct = kind === 'notebook' || kind === 'oled';
  const queuePath = path.join(dataDir, kind==='oled'?'oled-detail-queue.json':'notebook-detail-queue.json');
  let detailQueue = {};
  if (checkedProduct) {
    try { detailQueue = JSON.parse(await fs.readFile(queuePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    detailQueue = Object.fromEntries(Object.entries(detailQueue).filter(([,entry]) => Date.now() - Date.parse(entry.last_observed_at) < 7 * 86400_000));
  }
  const limitedTerms = [];
  const queryYield = {};
  let pendingDetails = 0, detailReads = 0;
  const lock = await acquireMercadoLivreLock(profileDir);
  const startedAt = new Date();
  const logger = createMonitorLogger({ monitor: `mercadolivre:${id}` });
  const successfulTerms = [];
  const failedTerms = [];
  const collected = [];
  let consolidated = [];
  let aborted = false;
  let blockedError = null;
  let context;

  console.log(`Mercado Livre: ${label}`);
  console.log(`${terms.length} busca(s), coleta R$ ${formatNumber(minPrice)}-${formatNumber(maxPrice)}`);
  console.log(`Pausa entre acessos: ${delayMinMs}-${delayMaxMs} ms`);
  logger.start({ label, terms: terms.length, min_price: minPrice, max_price: maxPrice });

  try {
    const launchArgs = headless
      ? []
      : visible
        ? ["--start-maximized"]
        // Fora da tela + sem throttling de janela em segundo plano, para a
        // coleta seguir normal mesmo sem aparecer.
        : ["--window-position=-32000,-32000", "--window-size=1280,900", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"];
    context = await chromium.launchPersistentContext(profileDir, {
      channel: "chrome",
      headless,
      viewport: null,
      locale: "pt-BR",
      args: launchArgs,
    });
    // Economia de dados/eficiência: não baixa imagens, mídia nem fontes — o
    // scraper só lê texto (título, preço, ficha). Mantém CSS/JS (SPA do ML).
    // --load-assets desativa (diagnóstico/se o ML degradar a página sem imagens).
    if (!loadAssets) {
      await context.route("**/*", (route) => {
        const type = route.request().resourceType();
        if (["image", "media", "font"].includes(type)) return route.abort();
        return route.continue();
      }).catch(() => {});
    }
    const page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);

    for (let index = 0; index < terms.length; index += 1) {
      const task = normalizeTask(terms[index]);
      if (index > 0) await sleep(randomBetween(delayMinMs, delayMaxMs));
      console.log(`[${index + 1}/${terms.length}] ${task.query}`);
      try {
        const accepted = await retryTransient(async () => {
          await page.goto(buildSearchUrl(task.query, {
            minPrice,
            maxPrice,
            ...searchOptions,
            ...(task.searchOptions ?? {}),
          }), { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
          await sleep(randomBetween(delayMinMs, delayMaxMs));
          const state = await detectPageState(page);
          // A recognized empty search is a completed term. Missing/unrecognized
          // cards still fail, so layout changes cannot erase previous results.
          if (state === "empty") { if(kind==='oled')queryYield[task.matchTerm]={raw:0,accepted:0}; return []; }
          if (state !== "results") {
            const error = new Error(pageStateMessage(state));
            error.pageState = state;
            throw error;
          }
          const raw = await collectSearchResults(page);
          if (checkedProduct && (raw.length > maxItemsPerTerm || await page.locator('.andes-pagination__button--next:not(.andes-pagination__button--disabled)').count() > 0)) limitedTerms.push(task.matchTerm);
          if (raw.length === 0) throw new Error("Nenhum card reconhecido; possivel mudanca de layout.");
          const exclusions = excludeTerms.map(normalizeText);
          if(kind==='oled')queryYield[task.matchTerm]={raw:raw.length,outside_price:raw.filter(i=>i.price_brl<minPrice||i.price_brl>maxPrice).length,
            scope_rejected:raw.filter(i=>i.price_brl>=minPrice&&i.price_brl<=maxPrice&&!termMatcher(i.title,task.matchTerm)).length};
          return raw
            .filter((item) => item.price_brl >= minPrice && item.price_brl <= maxPrice)
            .filter((item) => termMatcher(item.title, task.matchTerm))
            .filter((item) => !exclusions.some((term) => normalizeText(item.title).includes(term)))
            .filter((item) => !itemFilter || itemFilter(item))
            .slice(0, maxItemsPerTerm)
            .map((item) => ({
              ...item,
              id: extractMercadoLivreId(item.url) ?? item.id ?? item.url,
              source: "Mercado Livre",
              terms: [task.matchTerm],
              status: "active",
            }));
        }, {
          sleep,
          onRetry: ({ attempt, delayMs, classification }) => {
            logger.warn("term_retry", { term: task.matchTerm, attempt, delay_ms: delayMs, kind: classification.kind });
            console.warn(`  Erro transitorio; aguardando ${Math.round(delayMs / 1000)}s para tentar uma vez mais.`);
          },
        });
        collected.push(...accepted);
        successfulTerms.push(task.matchTerm);
        console.log(`  ${accepted.length} item(ns) aceito(s)`);
        logger.info("term_succeeded", { term: task.matchTerm, accepted: accepted.length });
      } catch (error) {
        const classification = classifyMonitorError(error);
        failedTerms.push({ term: task.matchTerm, error: error.message, kind: classification.kind });
        console.warn(`  Falhou com seguranca: ${error.message}`);
        logger.error("term_failed", error, { term: task.matchTerm, kind: classification.kind });
        if (["challenge", "limited", "logged_out"].includes(error.pageState)) {
          aborted = true;
          console.warn("Fila interrompida para evitar acessos adicionais.");
          break;
        }
      }
    }

    const deduped = dedupeMercadoLivreItems(collected);
    consolidated = deduped;
    const detailCandidates = deduped
      .filter(item => kind !== 'notebook' || notebookRamGb(item) == null || notebookRamGb(item) >= NOTEBOOK_MIN_RAM_GB)
      .filter((item) => needsMercadoLivreDetail(item, previousById.get(item.id), kind, relevantDetails))
      .sort((a,b) => kind !== 'notebook' ? 0 : Number(a.price_brl > displayMaxPrice) - Number(b.price_brl > displayMaxPrice)
        || (Date.parse(detailQueue[a.id]?.first_queued_at) || 0) - (Date.parse(detailQueue[b.id]?.first_queued_at) || 0));
    if (checkedProduct) for (const item of detailCandidates) detailQueue[item.id] = {
      first_queued_at: detailQueue[item.id]?.first_queued_at ?? new Date().toISOString(), last_observed_at: new Date().toISOString(), terms: item.terms };
    const selectedDetails = detailCandidates
      .slice(0, maxDetails);
    for (let index = 0; index < selectedDetails.length; index += 1) {
      const item = selectedDetails[index];
      if (index > 0) await sleep(randomBetween(detailDelayMinMs, detailDelayMaxMs));
      try {
        const details = await collectProductDetails(page, item.url, { scoped: checkedProduct });
        detailReads++;
        Object.assign(item, details, { listing_title: item.title, details_checked_at: new Date().toISOString(), detail_listing_title: item.title });
        if (checkedProduct) {
          if (details.detail_price_brl == null) item.price_error = 'Preço integral do detalhe não localizado';
          else if (Math.abs(details.detail_price_brl - item.price_brl) > 1) item.price_error = 'Preço da listagem diverge do detalhe';
          if(kind==='notebook')item.notebook_validation = assessNotebook(item);
          else item.oled_validation=assessOledMonitor(item);
          delete detailQueue[item.id];
        }
        console.log(`  Ficha ${index + 1}/${detailCandidates.length}: ${item.title.slice(0, 65)}`);
      } catch (error) {
        item.detail_error = error.message;
        console.warn(`  Ficha nao coletada: ${error.message}`);
        if (/verificacao|limitou|sessao expirada/i.test(error.message)) {
          aborted = true;
          blockedError = { stage: 'details', error: error.message, kind: classifyMonitorError(error).kind };
          break;
        }
      }
    }
    if (checkedProduct) {
      for (const item of deduped) {
        if (!item.details_checked_at && !detailQueue[item.id]) Object.assign(item, {
          specs: previousById.get(item.id)?.specs, description: previousById.get(item.id)?.description,
          details_checked_at: previousById.get(item.id)?.details_checked_at,
          detail_listing_title: previousById.get(item.id)?.detail_listing_title,
          identity_error: previousById.get(item.id)?.identity_error, price_error: previousById.get(item.id)?.price_error,
        });
        const field=kind==='oled'?'oled_validation':'notebook_validation';
        item[field] = kind==='oled'?assessOledMonitor(item):assessNotebook(item);
        if (detailQueue[item.id]) item[field] = { ...item[field], state: 'pending', reasons: [...item[field].reasons, 'Ficha atualizada pendente'] };
      }
      pendingDetails = Object.keys(detailQueue).length;
      await writeJsonAtomic(queuePath, detailQueue, { validate: null });
    }
  } finally {
    await context?.close().catch(() => {});
    await lock.release();
  }

  // Reapply category rules after reading the detail title, and to carried items.
  const isInScope = item => !excludeTerms.some(term => normalizeText(item.title).includes(normalizeText(term)))
    && (!itemFilter || itemFilter(item));
  // Keep OLED rejections with their current evidence for the negative cache.
  consolidated = kind==='oled'?consolidated:consolidated.filter(isInScope);
  const coverageFailures = [...failedTerms, ...[...new Set(limitedTerms)].map(term => ({ term, error: 'Limite de resultados atingido; cobertura incompleta' }))];
  const completedTerms = successfulTerms.filter(term => !limitedTerms.includes(term));
  const completedAt = new Date();
  const snapshot = mergeMercadoLivreBatch({
    previous,
    collected: consolidated,
    successfulTerms: completedTerms,
    failedTerms: coverageFailures.map((failure) => failure.term),
    scheduledTerms: terms.map((term) => normalizeTask(term).matchTerm),
    allTerms: allTerms.map((term) => normalizeTask(term).matchTerm),
    now: completedAt,
    minPrice,
    maxPrice,
    displayMinPrice,
    displayMaxPrice,
    run: {
      id,
      label,
      kind,
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      partial: failedTerms.length > 0 || aborted || limitedTerms.length > 0 || pendingDetails > 0,
      limited_terms: [...new Set(limitedTerms)], pending_details: pendingDetails, detail_reads: detailReads,
      ...(kind==='oled'?{oled_policy_version:OLED_POLICY_VERSION,query_yield:queryYield}:{}),
      pending_detail_terms: [...new Set(Object.values(detailQueue).flatMap(entry => entry.terms ?? []))],
      aborted,
      blocked_error: blockedError,
      successful_terms: completedTerms,
      scheduled_terms: terms.map((term) => normalizeTask(term).matchTerm),
      configured_terms: allTerms.map((term) => normalizeTask(term).matchTerm),
      failed_terms: coverageFailures,
    },
  });
  snapshot.items = snapshot.items.map(item => isInScope(item) ? item : {
    ...item, status: 'out_of_scope', out_of_scope_at: item.out_of_scope_at ?? completedAt.toISOString(),
    scope_rejection_reason: 'Produto fora dos critérios da busca após conferir o título do detalhe',
  });
  if(kind==='oled'){
    snapshot.items=snapshot.items.map(classifySavedOledItem);
    snapshot.pending_items=snapshot.items.filter(i=>i.status==='active'&&i.oled_validation.state==='pending');
    for(const [term,metrics] of Object.entries(queryYield)){
      const hits=snapshot.items.filter(i=>i.status==='active'&&i.terms?.includes(term));
      metrics.approved=hits.filter(isApprovedOledMonitor).length;
      metrics.pending=hits.filter(i=>i.oled_validation?.state==='pending').length;
      metrics.exclusive=hits.filter(i=>isApprovedOledMonitor(i)&&i.terms.length===1).length;
    }
  }
  const changes = buildMercadoLivreChanges(previous, snapshot, { displayMinPrice, displayMaxPrice, kind });
  const runId = completedAt.toISOString().replace(/[:.]/g, "-");
  const committed = await commitMonitorRun(dataDir, {
    runId,
    snapshot,
    report: renderMercadoLivreReport(snapshot, changes),
    metadata: { source: id, label, collected_count: consolidated.length, failed_term_count: failedTerms.length },
  });
  const snapshotPath = committed.legacySnapshotPath;
  const reportPath = committed.legacyReportPath;
  logger.done({ partial: snapshot.run?.partial, collected: consolidated.length, failed_terms: failedTerms.length });
  console.log(`Snapshot: ${snapshotPath}`);
  console.log(`Relatorio: ${reportPath}`);
  if (committed.invalidItems.length) console.warn(`${committed.invalidItems.length} item(ns) foram para a quarentena.`);
  return { snapshot: committed.snapshot, changes, snapshotPath, reportPath, manifest: committed.manifest };
}

export function dedupeMercadoLivreItems(items) {
  const byId = new Map();
  for (const raw of items ?? []) {
    const id = extractMercadoLivreId(raw.url) ?? raw.id ?? raw.url;
    const item = { ...raw, id, terms: [...new Set(raw.terms ?? (raw.term ? [raw.term] : []))] };
    const current = byId.get(id);
    if (!current) {
      byId.set(id, item);
      continue;
    }
    const preferred = preferItem(current, item);
    byId.set(id, {
      ...current,
      ...preferred,
      terms: [...new Set([...(current.terms ?? []), ...(item.terms ?? [])])],
    });
  }
  return [...byId.values()];
}

export function mergeMercadoLivreBatch({
  previous,
  collected,
  successfulTerms,
  failedTerms,
  scheduledTerms = [...successfulTerms, ...failedTerms],
  allTerms = scheduledTerms,
  now = new Date(),
  minPrice,
  maxPrice,
  displayMinPrice,
  displayMaxPrice,
  run,
}) {
  return mergeMonitorSnapshot({
    previousSnapshot: previous,
    collected,
    now,
    run,
    scheduledCoverage: scheduledTerms,
    successfulCoverage: successfulTerms,
    failedCoverage: failedTerms,
    configuredCoverage: allTerms,
    itemCoverage: (item) => item.terms ?? (item.term ? [item.term] : []),
    dedupe: dedupeMercadoLivreItems,
    filters: {
      ...(run?.kind === 'notebook' ? { ram_gb: { min: NOTEBOOK_MIN_RAM_GB } } : {}),
      collection_price_brl: { min: minPrice, max: maxPrice },
      display_price_brl: { min: displayMinPrice, max: displayMaxPrice },
    },
  });
}

export function buildMercadoLivreChanges(previous, current, { displayMinPrice, displayMaxPrice, kind = current.run?.kind ?? (current.run?.id === 'notebooks' ? 'notebook' : 'product') }) {
  const visible = (item) => (kind !== "notebook" || isEligibleNotebook(item)) && (kind!=='oled'||isApprovedOledMonitor(item)) && item.status === "active"
    && Number(item.price_brl) >= displayMinPrice
    && Number(item.price_brl) <= displayMaxPrice;
  const eligiblePrevious = ['notebook','oled'].includes(kind) && previous
    ? { ...previous, items: (previous.items ?? []).filter(kind==='oled'?isApprovedOledMonitor:isEligibleNotebook) } : previous;
  const { newItems, priceChanges } = buildMonitorChanges(eligiblePrevious, current, {
    include: visible,
    reactivationIsNew: false,
  });
  const enteredDisplayRange = priceChanges.filter((item) => Number(item.previous_price_brl) > displayMaxPrice);
  return { newItems, priceChanges, enteredDisplayRange };
}

export async function acquireMercadoLivreLock(profileDir, { staleMs = LOCK_STALE_MS } = {}) {
  const lockPath = `${profileDir}.monitor.lock`;
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  try {
    const handle = await fs.open(lockPath, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
    await handle.close();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stat = await fs.stat(lockPath).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > staleMs) {
      await fs.unlink(lockPath).catch(() => {});
      return acquireMercadoLivreLock(profileDir, { staleMs });
    }
    throw new Error("Ja existe uma coleta do Mercado Livre em andamento.");
  }
  return {
    path: lockPath,
    release: () => fs.unlink(lockPath).catch(() => {}),
  };
}

async function collectProductDetails(page, url, { scoped = false } = {}) {
  const expectedId = extractMercadoLivreId(url);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
  await sleep(randomBetween(8_000, 14_000));
  const state = await detectProductPageState(page);
  if (state !== "product") throw new Error(pageStateMessage(state));
  const finalId = extractMercadoLivreId(page.url());
  const result = await page.evaluate(scoped => {
    const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
    const title = clean(document.querySelector("h1")?.textContent);
    const bodyText = clean(document.body?.innerText);
    const condition = bodyText.match(/(?:^|\s)(Novo|Usado|Recondicionado)(?:\s|$)/i)?.[1] ?? null;
    const specs = [];
    const seen = new Set();
    const selector = scoped ? '.ui-pdp-specs tr, .ui-pdp-specs__table tr, [data-testid="technical-specifications"] tr, .ui-vpp-highlighted-specs .andes-table__row' : 'tr, .andes-table__row, li';
    for (const row of document.querySelectorAll(selector)) {
      const cells = [...row.querySelectorAll("th, td, .andes-table__header, .andes-table__column")]
        .map((cell) => clean(cell.textContent))
        .filter(Boolean);
      let value = cells.length >= 2 ? `${cells[0]}: ${cells.slice(1).join(" ")}` : clean(row.textContent);
      if (!value || value.length > 220 || seen.has(value)) continue;
      if (!/(processador|memoria|memória|ssd|placa grafica|placa gráfica|modelo|marca|capacidade|voltagem|tamanho|condicao|condição|compatibilidade|portas?)/i.test(value)) continue;
      seen.add(value);
      specs.push(value);
    }
    const description = clean(document.querySelector(".ui-pdp-description__content, [data-testid='description-content']")?.textContent);
    const price = document.querySelector('.ui-pdp-price__second-line .andes-money-amount');
    const fraction = price?.querySelector('.andes-money-amount__fraction')?.textContent?.replace(/\D/g, '');
    const cents = price?.querySelector('.andes-money-amount__cents')?.textContent;
    return { title: title || undefined, condition, specs: specs.slice(0, 80), description: description || null,
      detail_price_brl: fraction ? Number(fraction) + Number(cents || 0) / 100 : null };
  }, scoped);
  if (scoped && expectedId && finalId !== expectedId) result.identity_error = 'Página de detalhe não confirma a identidade do anúncio';
  return result;
}

async function detectProductPageState(page) {
  const url = page.url();
  const title = await page.title().catch(() => "");
  const body = await page.locator("body").innerText().catch(() => "");
  const text = normalizeText(`${title}\n${body}`);
  if (/login|registration|auth/.test(new URL(url).pathname)) return "logged_out";
  if (/captcha|verifique que voce e humano|nao sou um robo/.test(text)) return "challenge";
  if (/muitas solicitacoes|temporariamente indisponivel/.test(text)) return "limited";
  if (await page.locator("h1").count() > 0) return "product";
  return "unknown";
}

export function needsMercadoLivreDetail(item, old, kind, relevantDetails) {
  if (!old?.details_checked_at) return true;
  if(kind==='oled')return old.oled_validation?.version!==OLED_POLICY_VERSION
    || !Number.isFinite(Date.parse(old.details_checked_at)) || Date.now()-Date.parse(old.details_checked_at)>=OLED_DETAIL_TTL_MS
    || (old.detail_listing_title??old.title)!==item.title || Number(old.price_brl)!==Number(item.price_brl);
  if (kind === "notebook") {
    if (old.notebook_validation?.version !== NOTEBOOK_POLICY_VERSION || Date.now() - Date.parse(old.details_checked_at) > 24 * 3600_000
        || (old.detail_listing_title ?? old.title) !== item.title) return true;
    const specs = extractMercadoLivreNotebookSpecs(old.specs);
    return !specs.cpuModel || !specs.ram;
  }
  const detailsText = normalizeText(`${old.title} ${old.description} ${(old.specs ?? []).join(" ")}`);
  return relevantDetails.some((detail) => {
    const normalizedDetail = normalizeText(detail);
    if (normalizedDetail === "condicao") return !old.condition;
    return !detailsText.includes(normalizedDetail);
  });
}

export function renderMercadoLivreReport(snapshot, changes) {
  const { run } = snapshot;
  const lines = [
    `# Mercado Livre - ${run.label}`,
    "",
    `Data: ${snapshot.generated_at.slice(0, 10)}`,
    `Cobertura parcial: **${run.partial ? "sim" : "nao"}**`,
    `Fila interrompida: **${run.aborted ? "sim" : "nao"}**`,
    `Termos concluidos: **${run.successful_terms.length}**`,
    `Termos com falha: **${run.failed_terms.length}**`,
    ...(run.kind === "notebook" ? [`RAM mínima instalada: **${NOTEBOOK_MIN_RAM_GB} GB**`] : []),
    ...(run.kind === 'notebook' ? [`Fichas lidas: **${run.detail_reads ?? 0}**; aguardando ficha: **${run.pending_details ?? 0}**; termos limitados: **${run.limited_terms?.length ?? 0}**`] : []),
    ...(run.kind === 'oled' ? [`Fichas lidas: **${run.detail_reads??0}**; pendentes: **${run.pending_details??0}**; termos limitados: **${run.limited_terms?.length??0}**`,
      'Aprovação automática não comprova estado físico ou ausência de burn-in.'] : []),
    ...(run.policy_reclassification ? [`Reclassificação de dados salvos; sem nova coleta. Coleta original: ${run.completed_at}.`] : []),
    `Novos produtos: **${changes.newItems.length}**`,
    `Alteracoes de preco: **${changes.priceChanges.length}**`,
    `Entraram na faixa do monitor: **${changes.enteredDisplayRange.length}**`,
    "",
    "## Novos produtos",
    ...reportItems(changes.newItems),
    "",
    "## Mudancas de preco",
    ...reportItems(changes.priceChanges, true),
    "",
    "## Entraram na faixa do monitor",
    ...reportItems(changes.enteredDisplayRange, true),
  ];
  if (run.failed_terms.length) {
    lines.push("", "## Falhas parciais", ...run.failed_terms.map((item) => `- ${item.term}: ${item.error}`));
  }
  if(run.kind==='oled')lines.push('', '## Candidatos pendentes de conferência',...(snapshot.pending_items??[]).map(item=>
    `- R$ ${formatNumber(item.price_brl)} - ${item.title} - ${item.url} — Pendente: ${item.oled_validation.reasons.join('; ')}`));
  return `${lines.join("\n")}\n`;
}

function reportItems(items, changed = false) {
  if (!items.length) return ["- Nenhum."];
  return items.map((item) => changed
    ? `- R$ ${formatNumber(item.previous_price_brl)} -> R$ ${formatNumber(item.price_brl)} - ${item.title} - ${item.url}`
    : `- R$ ${formatNumber(item.price_brl)} - ${item.title} - ${item.url}`);
}

function normalizeTask(term) {
  return typeof term === "string"
    ? { query: term, matchTerm: term }
    : { query: term.query, matchTerm: term.matchTerm ?? term.query, searchOptions: term.searchOptions };
}

function preferItem(left, right) {
  const leftDirect = /produto\.mercadolivre\.com\.br|\/p\/MLB/i.test(left.url);
  const rightDirect = /produto\.mercadolivre\.com\.br|\/p\/MLB/i.test(right.url);
  if (rightDirect && !leftDirect) return right;
  if (Number(right.price_brl) < Number(left.price_brl)) return right;
  return left;
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function nonNegativeNumber(value, fallback) {
  // value ausente (null/undefined/"") = "não informado" → usa o fallback.
  // Sem isto, Number(null) === 0 e (0 >= 0) devolvia 0, zerando maxDetails e
  // desligando a fase de ficha em toda execução sem --max-details explícito.
  if (value == null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeText(value) {
  return normalizeMonitorText(value);
}

function formatNumber(value) {
  return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
