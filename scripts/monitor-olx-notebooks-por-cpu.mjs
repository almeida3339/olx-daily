import { setMonitorExit } from './lib/monitor-outcome.mjs';
import { reserveOlxAccess, recordOlxYield, readOlxTraffic } from './lib/olx-traffic.mjs';
import { extractNotebookRamText, meetsNotebookRamMinimum, NOTEBOOK_MIN_RAM_GB, notebookCpuTerms, hasExplicitOtherNotebookCpu } from './lib/notebook-policy.mjs';
import { OLX_NOTEBOOK_FAMILIES, planNotebookFamilies, notebookOpportunity } from './lib/notebook-search-plan.mjs';
import fs from "node:fs/promises";
import { createDescriptionQueue, cardCpuState, cardKey } from "./lib/olx-description-queue.mjs";
import { readOlxListing, finishOlxListing } from './lib/olx-listing.mjs';
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  parseBrlPrice,
  extractRamGb,
  extractStorageGb,
  extractGpuLabel,
  textContainsCpuTerm,
  isNotebookCategoryUrl,
  extractOlxId,
  normalizeText,
} from "./lib/parsers.mjs";
import { mergeWithPreviousSnapshot as _mergeItems } from "./lib/snapshot.mjs";
import { mergeMonitorSnapshot } from "./lib/monitor-core.mjs";
import { classifyMonitorError } from "./lib/monitor-errors.mjs";
import { sanitizeErrorMessage } from "./lib/notification-status.mjs";
import { DEFAULT_CPU_TERMS, cpuSearchQuery } from "./lib/cpu-terms.mjs";
import { commitMonitorRun, readLatestValidSnapshot, readJsonValidated, writeJsonAtomic } from "./lib/monitor-runtime.mjs";
import { OLX_QUALITY_VERSION, orderOlxCpuTerms, planOlxCpuTerms, olxSpecs, pendingOlxItem, validateOlxNotebook, readOlxNotebookDetail, notebookExclusionReason, assertOlxAccessible, isValidatedOlxItem, revalidateSavedOlxItem } from "./lib/olx-notebook-quality.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..");
const automationRoot = process.env.OLX_DATA_DIR ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".codex", "automations", "monitor-olx-notebooks-por-cpu");

const USER_DATA_DIR = path.join(workspaceRoot, ".chrome-olx-profile");
const REAL_CHROME_USER_DATA_DIR = path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "User Data");
const DEFAULT_CDP_URL = "http://127.0.0.1:9222";
const BASE_URL = "https://www.olx.com.br/brasil/informatica/notebooks";

const PRICE_MIN_BRL = 2000;
const PRICE_MAX_BRL = 8000;
// Mudanças de preço aparecem para itens até este teto (novos só vão até
// PRICE_MAX_BRL). Acima disso não interessa acompanhar variação.
const PRICE_CHANGE_MAX_BRL = 10000;
const NAVIGATION_TIMEOUT_MS = 30_000;
const DETAIL_TIMEOUT_MS = 25_000;
const RAW_SCROLL_DELAY_MS = Number(process.env.OLX_SCROLL_DELAY_MS ?? 350);
const RAW_STABLE_ROUNDS = Number(process.env.OLX_STABLE_ROUNDS ?? 2);


const args = process.argv.slice(2);
const headless = args.includes("--headless");
const visible = args.includes("--visible"); // mostra a janela (padrão: fora da tela, não atrapalha o trabalho)
const maxAdsPerCpu = Number(getOptionValue(args, "--max-per-cpu") ?? 20);
const debug = args.includes("--debug");
const forceOpenDetails = args.includes("--open-details");
const listingOnly = args.includes("--listing-only");
const cpuArg = getOptionValue(args, "--cpu");
const configuredCpuTerms = cpuArg ? cpuArg.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : DEFAULT_CPU_TERMS;
let cpuTerms = orderOlxCpuTerms(configuredCpuTerms);
const configuredSearches = [...configuredCpuTerms, ...(!cpuArg ? OLX_NOTEBOOK_FAMILIES.map(spec => spec.id) : [])];
const olxQuery = term => OLX_NOTEBOOK_FAMILIES.find(spec => spec.id === term)?.query ?? cpuSearchQuery(term);
let resumedProgress = null;
let descriptionQueue;
const searchedThisProcess = new Set();
async function reserveNotebookSearch(term) {
  await reserveOlxAccess({watchlist:'notebooks',query:term,kind:'search',
    force:Boolean(cpuArg)||args.includes('--full-sweep'),retry:searchedThisProcess.has(term)});
  searchedThisProcess.add(term);
}
const progressFile = path.join(automationRoot, "collection-progress.json");
const RESUME_MAX_AGE_MS = 6 * 3600_000;
const useCurrentChrome = args.includes("--current-chrome");
const useRealProfile = args.includes("--real-profile");
const profileDirectory = getOptionValue(args, "--profile-directory") ?? "Default";
const cdpUrl = getOptionValue(args, "--cdp-url") ?? process.env.CHROME_CDP_URL ?? DEFAULT_CDP_URL;
const blockAssets = !args.includes("--load-assets");

// Espaçamento entre buscas de CPU: em vez de disparar as ~22 buscas em sequência
// rápida (padrão fácil de reconhecer como automação), agrupa em lotes com pausa
// curta entre buscas do mesmo lote e pausa longa entre lotes — imita alguém
// pesquisando aos poucos ao longo da manhã/tarde, não um script varrendo tudo de
// uma vez. --no-pacing desliga (útil para depuração manual, onde esperar ~40min
// pra ver o resultado da rodada é impraticável); a tarefa agendada roda sem essa
// flag, então recebe o espaçamento por padrão.
const pacingEnabled = !args.includes("--no-pacing") && process.env.OLX_PACING_DISABLED !== "1";
const olxBatchSize = Number(process.env.OLX_BATCH_SIZE ?? 15);
const olxIntraBatchDelayMs = [
  Number(process.env.OLX_INTRA_BATCH_DELAY_MIN_MS ?? 2_000),
  Number(process.env.OLX_INTRA_BATCH_DELAY_MAX_MS ?? 20_000),
];
const olxInterBatchDelayMs = [
  Number(process.env.OLX_INTER_BATCH_DELAY_MIN_MS ?? 30 * 60_000),
  Number(process.env.OLX_INTER_BATCH_DELAY_MAX_MS ?? 50 * 60_000),
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`\nFalha: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

async function main() {
  const now = new Date();
  const runDate = now.toISOString().slice(0, 10);
  let runTimestamp = now.toISOString();

  const previousSnapshotResult = await readLatestValidSnapshot(automationRoot);
  const previousSnapshotPath = previousSnapshotResult.file ? path.join(automationRoot, previousSnapshotResult.file) : null;
  let previousSnapshot = previousSnapshotResult.snapshot;
  const savedProgress = await readJsonValidated(progressFile).catch(() => null);
  if (Date.parse(savedProgress?.blocked_until ?? '') > now.getTime() && !args.includes('--resume-after-verification')) {
    await saveDeferredNotebookRun(previousSnapshot,now,`OLX em pausa até ${savedProgress.blocked_until}; consultas adiadas.`);
    return;
  }
  const sameConfiguration = savedProgress?.configuration === configuredSearches.join(',');
  if (!args.includes('--full-sweep') && sameConfiguration && savedProgress.pending_terms?.length
      && now.getTime() - Date.parse(savedProgress.started_at) < RESUME_MAX_AGE_MS
      && Array.isArray(savedProgress.collected) && Array.isArray(savedProgress.successful_terms)
      && Array.isArray(savedProgress.scheduled_terms) && savedProgress.scheduled_terms.every(t => configuredSearches.includes(t))
      && savedProgress.baseline_snapshot && savedProgress.quality_version === OLX_QUALITY_VERSION) {
    resumedProgress = savedProgress;
    cpuTerms = savedProgress.scheduled_terms;
    // Uma rodada parcial já finalizada pode ter sido notificada. Comparar com
    // seu último snapshot evita reapresentar como novos os IDs já publicados.
    previousSnapshot = savedProgress.state === 'partial' && previousSnapshot
      ? previousSnapshot : savedProgress.baseline_snapshot;
    runTimestamp = savedProgress.started_at;
    console.log(`Retomando somente ${savedProgress.pending_terms.length} termo(s) pendente(s); ${savedProgress.successful_terms.length} concluído(s) preservado(s).`);
  } else {
    const traffic = await readOlxTraffic();
    cpuTerms = planOlxCpuTerms(configuredCpuTerms, previousSnapshot, {
      now: now.getTime(), fullSweep: Boolean(cpuArg) || args.includes('--full-sweep'),
      lowPriorityIntervalMs: Number(process.env.OLX_LOW_PRIORITY_INTERVAL_HOURS ?? 24) * 3600_000,
      traffic,
    });
    if (!cpuArg) cpuTerms.push(...planNotebookFamilies(previousSnapshot, { now: now.getTime(), fullSweep: args.includes('--full-sweep'), traffic }));
  }
  if(!cpuTerms.length){await saveDeferredNotebookRun(previousSnapshot,now,'Consultas adiadas pela frequência adaptativa.');return;}
  descriptionQueue = await createDescriptionQueue(path.join(automationRoot, 'description-candidates.json'), runTimestamp);
  console.log(`Plano OLX: ${cpuTerms.length}/${configuredCpuTerms.length} termos nesta rodada; CPUs prioritárias primeiro.`);

  console.log(`Execução: ${runTimestamp}`);
  console.log(`Snapshot anterior: ${previousSnapshotPath ?? "(nenhum)"}`);
  console.log(`Perfil: ${USER_DATA_DIR}`);
  console.log("");

  if (useCurrentChrome && !args.includes("--playwright-cdp")) {
    await runWithRawCdp({ cdpUrl, runDate, runTimestamp, previousSnapshot });
    return;
  }

  let { page, close } = useCurrentChrome
    ? await connectToCurrentChrome(cdpUrl)
    : useRealProfile
    ? await launchRealChromeProfile(profileDirectory, headless)
    : await launchDedicatedChromeProfile(headless);

  try {
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(60000);
    if (blockAssets) {
      await installPlaywrightRequestBlocking(page.context());
    }

    await collectOlxTerms({
      runDate, runTimestamp, previousSnapshot, transport: "playwright",
      collectTerm: (term) => collectForCpuTerm(page, term, maxAdsPerCpu, previousSnapshot),
      resetSession: async () => {
        const context = page.context();
        await page.close().catch(() => {});
        page = await context.newPage();
        page.setDefaultTimeout(30000);
        page.setDefaultNavigationTimeout(60000);
      },
    });
  } finally {
    if (useCurrentChrome) await page.close().catch(() => {});
    await close();
  }
}

async function saveDeferredNotebookRun(previousSnapshot,now,reason){
  const snapshot=mergeWithPreviousSnapshot({runDate:now.toISOString().slice(0,10),now,collected:[],previousSnapshot,
    successfulTerms:[],failedTerms:[],scheduledTerms:[],run:{started_at:now.toISOString(),completed_at:now.toISOString(),
      partial:true,in_progress:false,phase:'deferred',successful_terms:[],failed_terms:[],errors:[{kind:'deferred',error:reason}],
      unattempted_terms:[],deferred_coverage:configuredSearches}});
  const report=buildReport({runDate:now.toISOString().slice(0,10),snapshot,previousSnapshot,priceMin:PRICE_MIN_BRL,priceMax:PRICE_MAX_BRL});
  const committed=await commitMonitorRun(automationRoot,{runId:now.toISOString().replace(/[:.]/g,'-'),snapshot,report,metadata:{source:'olx-notebooks',deferred:true}});
  console.log(reason);setMonitorExit(committed.snapshot.run);
}

async function runWithRawCdp({ cdpUrl, runDate, runTimestamp, previousSnapshot }) {
  let tab;
  const resetSession = async () => {
    await tab?.closeTab().catch(() => {});
    await fetchJson(`${cdpOrigin(cdpUrl)}/json/version`);
    tab = await openOrReuseCdpTab(cdpUrl);
    await tab.send("Page.enable");
    await tab.send("Runtime.enable");
    if (blockAssets) await installRawRequestBlocking(tab);
    console.log('Sessão CDP OLX renovada.');
  };
  try {
    await resetSession();

    await collectOlxTerms({
      runDate, runTimestamp, previousSnapshot, transport: "cdp",
      collectTerm: (term) => collectForCpuTermRawCdp(tab, term, maxAdsPerCpu, previousSnapshot),
      resetSession,
    });
  } finally {
    await tab?.closeTab().catch(() => {});
  }

}

async function collectOlxTerms({ runDate, runTimestamp, previousSnapshot, transport, collectTerm, resetSession }) {
  const collected = [...(resumedProgress?.collected ?? [])];
  const successfulTerms = [...(resumedProgress?.successful_terms ?? [])];
  const failedTerms = [];
  const queryYield = { ...(resumedProgress?.query_yield ?? {}) };
  let blockedUntil = null;
  const persistProgress = async (inProgress) => writeJsonAtomic(progressFile, {
    schema_version: 1, quality_version: OLX_QUALITY_VERSION, configuration: configuredSearches.join(','),
    started_at: runTimestamp, updated_at: new Date().toISOString(), state: inProgress ? 'collecting' : failedTerms.length ? 'partial' : 'completed',
    scheduled_terms: cpuTerms, successful_terms: successfulTerms, collected,
    pending_terms: cpuTerms.filter(term => !successfulTerms.includes(term)),
    baseline_snapshot: previousSnapshot ?? { items: [] }, blocked_until: blockedUntil,
    description_discovery: descriptionQueue.summary(),
    query_yield: queryYield,
  }, { validate: null });

  const saveProgress = async (inProgress) => {
    const savedAt = new Date();
    const unattemptedTerms = cpuTerms.filter((term) => !successfulTerms.includes(term)
      && !failedTerms.some((failure) => failure.term === term));
    const snapshot = mergeWithPreviousSnapshot({
      runDate, now: savedAt, collected, previousSnapshot, successfulTerms, failedTerms,
      scheduledTerms: cpuTerms.filter(term => !failedTerms.some(failure => failure.term === term && failure.kind === 'deferred')),
      run: {
        started_at: runTimestamp,
        completed_at: inProgress ? null : savedAt.toISOString(),
        in_progress: inProgress,
        phase: inProgress ? "collecting" : failedTerms.length ? "partial" : "completed",
        partial: inProgress || failedTerms.length > 0 || unattemptedTerms.length > 0,
        successful_terms: [...successfulTerms],
        failed_terms: failedTerms.filter(failure => failure.kind !== 'deferred'),
        errors: failedTerms.filter(failure => failure.kind !== 'deferred'),
        deferred_coverage: failedTerms.filter(failure => failure.kind === 'deferred').map(failure => failure.term),
        unattempted_terms: unattemptedTerms,
        description_discovery: descriptionQueue.summary(),
        query_yield: queryYield,
      },
    });
    const report = buildReport({
      runDate, snapshot, previousSnapshot, priceMin: PRICE_MIN_BRL, priceMax: PRICE_MAX_BRL,
    });
    // Separate immutable artifacts for each saved batch keep the previous
    // manifest valid until the new pointer has been promoted atomically.
    const committed = await commitMonitorRun(automationRoot, {
      runId: savedAt.toISOString().replace(/[:.]/g, "-"), snapshot, report,
      metadata: {
        source: "olx-notebooks", transport, collection_started_at: runTimestamp,
        collected_count: collected.length, failed_term_count: failedTerms.length,
        successful_term_count: successfulTerms.length, in_progress: inProgress,
        validated_count: collected.filter(isValidatedOlxItem).length,
        pending_count: collected.filter(item => item.validation?.state === 'pending').length,
        rejected_count: collected.filter(item => item.validation?.state === 'rejected').length,
      },
    });
    console.log(`${inProgress ? "Progresso do lote" : "Snapshot"} salvo: ${committed.legacySnapshotPath}`);
    if (!inProgress) console.log(`Relatório salvo: ${committed.legacyReportPath}`);
    if (committed.invalidItems.length) console.warn(`${committed.invalidItems.length} item(ns) foram para a quarentena.`);
    if (!inProgress) setMonitorExit(committed.snapshot.run);
    await persistProgress(inProgress);
  };

  try {
    await forEachOlxTerm(cpuTerms.filter(term => !successfulTerms.includes(term)), async (term) => {
      try {
        let results;
        const detailsBefore = descriptionQueue.summary().total_details ?? 0;
        try { results = await collectTerm(term); }
        catch (error) {
          if (!classifyMonitorError(error).retriable) throw error;
          console.warn(`Falha transitória em ${term}; renovando sessão e tentando este termo uma vez após 30 s.`);
          await delay(30_000);
          try { await resetSession(); }
          catch (sessionError) { sessionError.sessionUnavailable = true; throw sessionError; }
          results = await collectTerm(term);
        }
        for (const item of results) {
          const existing = collected.findIndex(x => (x.id ?? x.url) === (item.id ?? item.url));
          if (existing < 0) collected.push(item);
          else collected[existing] = item;
        }
        if (results.coverage_incomplete) failedTerms.push({ term, error: results.incomplete_reasons.join('; '), kind: 'incomplete' });
        else successfulTerms.push(term);
        queryYield[term] = { returned: results.length, validated: results.filter(isValidatedOlxItem).length,
          pending: results.filter(item => item.validation?.state === 'pending').length,
          detail_reads: (descriptionQueue.summary().total_details ?? 0) - detailsBefore,
          limited: Boolean(results.coverage_incomplete), listing_incomplete: Boolean(results.listing_incomplete), listing_limit:results.listing_limit,
          details_pending: results.details_pending ?? 0, total_results: results.total_results ?? null,
          recommendations_ignored: results.recommendations_ignored ?? 0 };
        await recordOlxYield('notebooks',term,{complete:!results.coverage_incomplete,
          listingLimit:results.listing_limit,listingIncomplete:Boolean(results.listing_incomplete),
          items:results.filter(item=>isValidatedOlxItem(item)&&item.price_brl<=PRICE_MAX_BRL)});
        console.log(`  ${results.filter(isValidatedOlxItem).length} validado(s), ${results.filter(x => x.validation?.state === 'pending').length} pendente(s), ${results.filter(x => x.validation?.state === 'rejected').length} rejeitado(s).`);
      } catch (error) {
        const message = sanitizeErrorMessage(error?.message ?? error);
        failedTerms.push({ term, error: message, kind: error.kind ?? classifyMonitorError(error).kind });
        console.warn(`  Aviso: termo "${term}" falhou (${message}) — pulando para o próximo.`);
        if (error.sessionUnavailable) throw error;
        if (['challenge', 'authentication', 'rate_limited'].includes(classifyMonitorError(error).kind)) {
          blockedUntil = new Date(Date.now() + 24 * 3600_000).toISOString();
          throw error;
        }
      }
      await persistProgress(true);
    }, { onBatchCompleted: () => saveProgress(true), onBatchResumed: resetSession });
  } catch (error) {
    if (!failedTerms.some(f => f.error === sanitizeErrorMessage(error?.message ?? error))) failedTerms.push({ term: "coleta", error: sanitizeErrorMessage(error?.message ?? error), kind: classifyMonitorError(error).kind });
    await saveProgress(false);
    throw error;
  }
  await saveProgress(false);
  if (failedTerms.length) {
    console.warn(`Coleta OLX: ${failedTerms.filter(item=>item.kind!=='deferred').length} consulta(s) incompleta(s), ${failedTerms.filter(item=>item.kind==='deferred').length} adiada(s). Dados sem cobertura preservados.`);
  }
}

async function launchDedicatedChromeProfile(headlessMode) {
  const isCI = Boolean(process.env.CI);
  const launchOptions = {
    headless: headlessMode,
    viewport: null,
    locale: "pt-BR",
    args: isCI
      ? [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--window-size=1280,900",
          "--disable-blink-features=AutomationControlled",
        ]
      : visible
        ? ["--start-maximized", "--disable-blink-features=AutomationControlled"]
        // Fora da tela por padrão (não atrapalha o trabalho); janela "real" para o Cloudflare.
        : ["--window-position=-32000,-32000", "--window-size=1280,900", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-blink-features=AutomationControlled"],
  };
  if (!isCI) launchOptions.channel = "chrome";
  if (isCI) {
    launchOptions.userAgent =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  }

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, launchOptions);
  // Remove navigator.webdriver to reduce bot-detection signal.
  await context.addInitScript(() => {
    try { delete Object.getPrototypeOf(navigator).webdriver; } catch (_) {}
  });
  return { page: context.pages()[0] ?? (await context.newPage()), close: () => context.close() };
}

async function launchRealChromeProfile(selectedProfileDirectory, headlessMode) {
  const chromeArgs = [
    ...(visible
      ? ["--start-maximized"]
      : ["--window-position=-32000,-32000", "--window-size=1280,900", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"]),
    `--profile-directory=${selectedProfileDirectory}`,
  ];
  const context = await chromium.launchPersistentContext(REAL_CHROME_USER_DATA_DIR, {
    channel: "chrome",
    headless: headlessMode,
    viewport: null,
    locale: "pt-BR",
    args: chromeArgs,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  return { page, close: () => context.close() };
}

async function connectToCurrentChrome(cdpEndpoint) {
  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpEndpoint);
  } catch {
    throw new Error(
      `Não consegui conectar ao Chrome atual em ${cdpEndpoint}. Abra o Chrome com depuração remota (scripts\\\\start-chrome-debug.ps1) e tente novamente com --current-chrome.`
    );
  }

  const context = browser.contexts()[0];
  if (!context) {
    throw new Error("Conectei ao Chrome, mas não encontrei nenhum contexto de navegador.");
  }

  const page = await context.newPage();
  return { page, close: async () => {} };
}

async function collectForCpuTerm(page, cpuTerm, maxCards, previousSnapshot) {
  maxCards=await notebookListingLimit(cpuTerm,maxCards,previousSnapshot);
  const query = encodeURIComponent(olxQuery(cpuTerm));
  const url = `${BASE_URL}?q=${query}&sp=1&opst=2`;
  console.log(`\nCPU: ${cpuTerm} -> ${url}`);

  await reserveNotebookSearch(cpuTerm);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
  await waitOutCloudflareIfNeeded(page);
  const hasCards = await waitForListingReadinessPlaywright(page);
  if (!hasCards) {
    if (debug) console.log("  Nenhum card encontrado na primeira pagina.");
    return processCpuCards([], cpuTerm, maxCards, previousSnapshot, card => enrichAd(page, card));
  }

  const cards = await collectCardsFromInfiniteScroll(page, maxCards);
  if (debug) {
    console.log(`  Cards brutos: ${cards.length}`);
  }

  return processCpuCards(cards, cpuTerm, maxCards, previousSnapshot, card => enrichAd(page, card));
}

async function collectForCpuTermRawCdp(tab, cpuTerm, maxCards, previousSnapshot) {
  maxCards=await notebookListingLimit(cpuTerm,maxCards,previousSnapshot);
  const url = `${BASE_URL}?q=${encodeURIComponent(olxQuery(cpuTerm))}&sp=1&opst=2`;
  console.log(`\nCPU: ${cpuTerm} -> ${url}`);
  await reserveNotebookSearch(cpuTerm);
  await navigateRawCdp(tab, url);
  await waitForRawLocation(tab, url);
  const hasCards = await waitForRawCardsFast(tab);
  const cards = hasCards ? await collectCardsRawCdp(tab, maxCards) : [];
  return processCpuCards(cards, cpuTerm, maxCards, previousSnapshot, card => enrichAdRawCdp(cdpUrl, card));
}

async function notebookListingLimit(term,base,previous){
  const traffic=await readOlxTraffic(),saved=traffic?.queries?.[`notebooks:${term}`];
  const last=previous?.run?.query_yield?.[term]??saved;
  const truncated=last?.listing_incomplete??/listagem incompleta/i.test(previous?.coverage_status?.[term]?.error??'');
  const prior=Number(last?.listing_limit??base);
  if(term.startsWith('family:'))return Math.min(90,Math.max(base,60,truncated?prior+30:prior));
  return term==='14900hx'||truncated?Math.min(60,Math.max(base,truncated?prior+24:Math.max(prior,36))):base;
}

async function processCpuCards(cards, cpuTerm, maxCards, previousSnapshot, openDetail) {
  const familySearch = cpuTerm.startsWith('family:');
  const eligible = [...new Map(cards.filter(card => card.url && card.title && card.price_brl != null
    && isNotebookCategoryUrl(card.url) && !hasExcludedKeyword(`${card.title}\n${card.text ?? ''}`)
    && (extractNotebookRamText(`${card.title}\n${card.text ?? ''}`) ?? NOTEBOOK_MIN_RAM_GB) >= NOTEBOOK_MIN_RAM_GB)
    .map(card => [cardKey(card), { ...card, cpu_term: cpuTerm }])).values()];
  const matches = eligible.filter(card => !familySearch && cardCpuState(`${card.title}\n${card.text ?? ''}`, cpuTerm) === 'match')
    .filter(card => card.price_brl >= PRICE_MIN_BRL && card.price_brl <= PRICE_CHANGE_MAX_BRL)
    .sort((a, b) => a.price_brl - b.price_brl);
  const unknown = eligible.filter(card => (familySearch ? !hasExplicitOtherNotebookCpu(`${card.title}\n${card.text ?? ''}`) : cardCpuState(`${card.title}\n${card.text ?? ''}`, cpuTerm) === 'unknown')
    && card.price_brl >= PRICE_MIN_BRL && card.price_brl <= PRICE_MAX_BRL);
  if (!listingOnly) await descriptionQueue.enqueue(unknown, cpuTerm);
  const waiting = listingOnly ? [] : descriptionQueue.pending(cpuTerm);
  // Reserve at most two of the existing item slots; no additional scrolling.
  const reserveSlots = Math.min(2, waiting.length, maxCards);
  const toProcess = [...matches.slice(0, maxCards - reserveSlots), ...waiting, ...matches.slice(maxCards - reserveSlots)];
  const items = [], seen = new Set();
  items.listing_incomplete = Boolean(cards.listing_incomplete);
  items.listing_limit=maxCards;
  items.total_results = cards.total_results ?? null;
  items.recommendations_ignored = cards.recommendations_ignored ?? 0;
  items.details_pending = 0;
  for (const card of toProcess) {
    const key = cardKey(card);
    if (seen.has(key)) continue;
    seen.add(key);
    const listingItem = listingCardToItem(card);
    if (listingOnly) { items.push(listingItem); continue; }
    const current = descriptionQueue.result(card);
    const cached = descriptionQueue.cached(card);
    const reusable = current ?? (!forceOpenDetails ? cached ?? getReusablePreviousEnrichedItem(previousSnapshot, card) : null);
    if (reusable) {
      // Preserve the CPU confirmed in the description, not the discovery query.
      items.push({ ...revalidateSavedOlxItem(reusable), search_terms: [...new Set([...(reusable.search_terms ?? []), cpuTerm])] });
      if (!current) await descriptionQueue.useCached(card, reusable);
      continue;
    }
    const inRange = card.price_brl >= PRICE_MIN_BRL && card.price_brl <= PRICE_MAX_BRL;
    if (!(card.description_discovery || forceOpenDetails || needsDetailEnrichment(listingItem) || inRange)) {
      items.push(listingItem); continue;
    }
    if (items.length >= maxCards || !await descriptionQueue.reserveDetail(cpuTerm, Boolean(card.description_discovery), card)) {
      await descriptionQueue.enqueue([{ ...card, description_discovery: Boolean(card.description_discovery) }], cpuTerm);
      items.details_pending++;
      items.push(pendingOlxItem(listingItem, 'Ficha aguardando leitura dentro dos limites da rodada'));
      continue;
    }
    const started = Date.now();
    try {
      const item = await openDetail(card);
      await descriptionQueue.remember(card, item, Date.now() - started);
      items.push(item);
    } catch (error) {
      if (['challenge', 'authentication', 'rate_limited'].includes(classifyMonitorError(error).kind)) throw error;
      const item = pendingOlxItem(listingItem, sanitizeErrorMessage(error.message));
      await descriptionQueue.remember(card, item, Date.now() - started);
      items.push(item);
      console.warn(`  Anúncio pendente: ${card.url} (${sanitizeErrorMessage(error.message)})`);
    }
  }
  const metrics = descriptionQueue.summary();
  items.incomplete_reasons = [
    ...(items.listing_incomplete ? [`Listagem incompleta: limite de ${maxCards} cards ou próxima página pendente`] : []),
    ...(items.details_pending ? [`${items.details_pending} ficha(s) aguardando leitura dentro dos limites da rodada`] : []),
  ];
  items.coverage_incomplete = items.incomplete_reasons.length > 0;
  console.log(`  Descrições adicionais: ${metrics.extra_details}/8 nesta rodada; ${metrics.queued_candidates} candidato(s) na fila.`);
  if (items.coverage_incomplete) console.log(`  Cobertura parcial: ${items.incomplete_reasons.join('; ')}.`);
  return items.sort((a, b) => a.price_brl - b.price_brl);
}

async function openOrReuseCdpTab(cdpEndpoint, url = "about:blank") {
  const origin = cdpOrigin(cdpEndpoint);
  const target = await fetchJson(`${origin}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  return connectRawCdpTarget(target, origin);
}

async function connectRawCdpTarget(target, origin) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id);
    clearTimeout(timer);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(message.error.message));
    } else {
      resolve(message);
    }
  };
  ws.onclose = () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('network: conexão CDP encerrada'));
    }
    pending.clear();
  };

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout ao conectar no WebSocket CDP")), 10_000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("falha no WebSocket CDP"));
    };
  });

  const send = (method, params = {}, timeoutMs = 15_000) =>
    new Promise((resolve, reject) => {
      if (ws.readyState !== WebSocket.OPEN) return reject(new Error('network: conexão CDP indisponível'));
      const message = { id: ++id, method, params };
      const timer = setTimeout(() => {
        pending.delete(message.id);
        reject(new Error(`timeout CDP em ${method}`));
      }, timeoutMs);
      pending.set(message.id, { resolve, reject, timer });
      try { ws.send(JSON.stringify(message)); }
      catch (error) { clearTimeout(timer); pending.delete(message.id); reject(error); }
    });

  return {
    target,
    send,
    close: () => {
      ws.close();
    },
    closeTab: async () => {
      ws.close();
      await fetch(`${origin}/json/close/${target.id}`).catch(() => {});
    },
  };
}

async function waitForRawCardsFast(tab) {
  const started = Date.now();
  while (Date.now() - started < 6_000) {
    const title = await rawEvaluate(tab, "document.title").catch(() => "");
    assertOlxAccessible(title);

    const count = await rawEvaluate(tab, "document.querySelectorAll('section.olx-adcard').length").catch(() => 0);
    if (Number(count) > 0) return true;

    const bodyText = await rawEvaluate(tab, "document.body?.innerText?.slice(0, 4000) || ''");
    assertOlxAccessible(bodyText);
    if (/(?:^|\n)\s*0\s+resultados?\b|nao encontramos|sem resultados|nenhum resultado/i.test(normalizeText(bodyText))) return false;

    await delay(700);
  }
  throw new Error('timeout: OLX não apresentou resultados nem confirmação de busca vazia');
}

async function collectCardsRawCdp(tab, maxCards) {
  const results = [], seen = new Set();
  let stableRounds = 0, lastCount = 0, payload = {};
  while (results.length <= maxCards && stableRounds < RAW_STABLE_ROUNDS) {
    payload = await rawEvaluate(tab, `(${readOlxListing.toString()})()`);
    for (const item of payload.items ?? []) {
      const normalized = normalizeListingCard(item);
      const key = normalized.url ? cardKey(normalized) : null;
      if (normalized.title && normalized.price_brl != null && key && !seen.has(key)) {
        seen.add(key); results.push(normalized);
      }
    }
    stableRounds = results.length === lastCount ? stableRounds + 1 : 0;
    lastCount = results.length;
    if (results.length > maxCards || (Number.isFinite(payload.totalResults) && results.length >= payload.totalResults)
      || !(payload.items?.length)) break;
    await rawEvaluate(tab, 'window.scrollBy(0, 2200); undefined');
    await delay(RAW_SCROLL_DELAY_MS);
  }
  return finishOlxListing(results, maxCards, payload);
}

function normalizeListingCard(item) {
  return { title: item.title?.trim(), url: item.url, price_brl: parseBrlPrice(item.priceText),
    location: item.location?.trim() || null, text: item.text || '',
    ram_gb: extractRamGb(`${item.title}\n${item.text}`), storage_gb: extractStorageGb(`${item.title}\n${item.text}`) };
}

async function enrichAdRawCdp(cdpEndpoint, card) {
  const tab = await openOrReuseCdpTab(cdpEndpoint);
  try {
    await tab.send("Page.enable");
    await tab.send("Runtime.enable");
    if (blockAssets) {
      await installRawRequestBlocking(tab);
    }
    await navigateRawCdp(tab, card.url);
    await waitForRawBody(tab);
    const detail = await rawEvaluate(tab, `(${readOlxNotebookDetail.toString()})()`);
    const bodyText = detail.body_text;
    const title = card.title;

    return {
      ...validateOlxNotebook(listingCardToItem(card), detail),
      id: extractOlxId(card.url),
      url: card.url,
      title,
      location: extractLocationFromText(bodyText),
      condition: extractConditionFromText(bodyText),
      status: "active",
      first_seen: null,
      last_seen: null,
      notes: null,
    };
  } finally {
    await tab.closeTab();
  }
}

async function waitForRawBody(tab) {
  const started = Date.now();
  while (Date.now() - started < DETAIL_TIMEOUT_MS) {
    assertOlxAccessible(await rawEvaluate(tab, "document.body?.innerText?.slice(0, 4000) || ''"));
    const textLength = await rawEvaluate(tab, "document.body?.innerText?.length || 0").catch(() => 0);
    if (Number(textLength) > 800) return;
    await delay(800);
  }
  throw new Error("não consegui ler o corpo do anúncio");
}

function listingCardToItem(card) {
  const listingText = `${card.title}\n${card.text ?? ""}`;
  return {
    id: extractOlxId(card.url),
    url: card.url,
    title: card.title,
    cpu_term: card.cpu_term,
    search_terms: [card.cpu_term],
    description_discovery: Boolean(card.description_discovery),
    price_brl: card.price_brl,
    ...olxSpecs(listingText),
    location: card.location ?? null,
    condition: null,
    status: "active",
    first_seen: null,
    last_seen: null,
    notes: listingOnly ? "Validado apenas pela página de listagem; descrição do anúncio não foi aberta." : null,
    desc_checked: false,
    validation: { version: OLX_QUALITY_VERSION, state: 'pending', reasons: ['Descrição e preço integral ainda não conferidos'] },
  };
}

function needsDetailEnrichment(item) {
  return item.ram_gb == null || item.gpu == null;
}

function getReusablePreviousEnrichedItem(previousSnapshot, card) {
  const current = listingCardToItem(card);
  const key = current.id ?? current.url;
  const previous = (previousSnapshot?.items ?? []).find((item) => (item.id ?? item.url) === key);
  if (!previous) return null;
  if (!isValidatedOlxItem(previous)) return null;
  if (previous.title !== current.title || previous.price_brl !== current.price_brl) return null;
  if (Date.now() - Date.parse(previous.validation.checked_at ?? '') > 12 * 3600_000
      || !Number.isFinite(Date.parse(previous.validation.checked_at ?? ''))) return null;
  if ((previous.notes ?? "").includes("Validado apenas")) return null;

  // Não reusa item da faixa do relatório cuja descrição nunca foi verificada
  // (snapshots antigos, anteriores à checagem de defeito): força reabrir para
  // que EXCLUDE_PATTERNS rode sobre o corpo do anúncio.
  const inReportRange = current.price_brl != null && current.price_brl >= PRICE_MIN_BRL && current.price_brl <= PRICE_MAX_BRL;
  if (inReportRange && !previous.desc_checked) return null;

  const merged = {
    ...previous,
    ...current,
    cpu_term: previous.cpu_term,
    ram_gb: previous.ram_gb,
    storage_gb: previous.storage_gb,
    gpu: previous.gpu,
    condition: previous.condition ?? current.condition ?? null,
    notes: previous.notes,
    desc_checked: previous.desc_checked ?? false,
    validation: previous.validation,
    status: "active",
  };
  return needsDetailEnrichment(merged) ? null : merged;
}

async function rawEvaluate(tab, expression) {
  const response = await tab.send("Runtime.evaluate", { expression, returnByValue: true }, 20_000);
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.text || "erro ao avaliar JavaScript na página");
  }
  return response.result?.result?.value;
}

async function navigateRawCdp(tab, url) {
  await tab.send("Page.navigate", { url }, NAVIGATION_TIMEOUT_MS);
}

async function waitForRawLocation(tab, expectedUrl) {
  const expected = new URL(expectedUrl);
  const started = Date.now();
  while (Date.now() - started < 5_000) {
    const href = await rawEvaluate(tab, "location.href").catch(() => "");
    if (href) {
      try {
        const current = new URL(href);
        if (
          current.origin === expected.origin &&
          current.pathname === expected.pathname &&
          current.searchParams.get("q") === expected.searchParams.get("q")
        ) {
          return;
        }
      } catch {
        // Chrome can expose transient URLs while the document is changing.
      }
    }
    await delay(150);
  }
}

async function installRawRequestBlocking(tab) {
  await tab.send("Network.enable").catch(() => {});
  await tab
    .send("Network.setBlockedURLs", {
      urls: [
        "*.png",
        "*.jpg",
        "*.jpeg",
        "*.webp",
        "*.gif",
        "*.svg",
        "*.ico",
        "*.mp4",
        "*.webm",
        "*.woff",
        "*.woff2",
        "*.ttf",
        "*.otf",
        "*googletagmanager.com/*",
        "*google-analytics.com/*",
        "*doubleclick.net/*",
        "*facebook.net/*",
      ],
    })
    .catch(() => {});
}

async function installPlaywrightRequestBlocking(context) {
  await context
    .route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["image", "media", "font"].includes(type)) {
        return route.abort();
      }
      return route.continue();
    })
    .catch(() => {});
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`falha HTTP ${response.status} em ${url}`);
  return response.json();
}

function cdpOrigin(cdpEndpoint) {
  const parsed = new URL(cdpEndpoint);
  return `${parsed.protocol}//${parsed.host}`;
}

function normalizeComparableUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Roda fn(term, index) para cada termo, respeitando o espaçamento configurado
// (ver pacingEnabled acima): pausa curta (olxIntraBatchDelayMs) entre termos do
// mesmo lote, pausa longa (olxInterBatchDelayMs) ao cruzar para o próximo lote
// de olxBatchSize termos. Sem pacing (--no-pacing), roda tudo em sequência como
// antes — sem pausa nenhuma, igual ao comportamento anterior a esta mudança.
async function forEachOlxTerm(terms, fn, { onBatchCompleted = async () => {}, onBatchResumed = async () => {} } = {}) {
  for (let index = 0; index < terms.length; index += 1) {
    const crossesBatch = index > 0 && index % olxBatchSize === 0;
    if (crossesBatch) await onBatchCompleted();
    if (index > 0 && pacingEnabled) {
      const [min, max] = crossesBatch ? olxInterBatchDelayMs : olxIntraBatchDelayMs;
      const waitMs = randomBetween(min, max);
      if (crossesBatch) {
        const pausedAt = new Date();
        const resumeAt = new Date(pausedAt.getTime() + waitMs);
        console.log(`\nLote concluído (${index}/${terms.length} termos) às ${brasiliaTime(pausedAt)}. Pausa de ${Math.round(waitMs / 60_000)} min antes do próximo lote (por volta de ${resumeTime(resumeAt, pausedAt)})...`);
        await waitWithPauseProgress(resumeAt);
        await onBatchResumed();
        console.log(`Retomando o próximo lote às ${brasiliaTime(new Date())} (${index}/${terms.length} termos já percorridos).`);
      } else {
        await delay(waitMs);
      }
    }
    await fn(terms[index], index);
  }
}

function brasiliaTime(date) {
  return date.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function resumeTime(resumeAt, pausedAt) {
  const dateOptions = { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" };
  const date = resumeAt.toLocaleDateString("pt-BR", dateOptions);
  return date === pausedAt.toLocaleDateString("pt-BR", dateOptions)
    ? brasiliaTime(resumeAt) : `${brasiliaTime(resumeAt)} de ${date}`;
}

async function waitWithPauseProgress(resumeAt) {
  while (Date.now() < resumeAt.getTime()) {
    const remaining = resumeAt.getTime() - Date.now();
    const chunk = Math.min(remaining, 5 * 60_000);
    await delay(chunk);
    const now = new Date();
    if (now.getTime() < resumeAt.getTime()) {
      console.log(`Pausa em andamento às ${brasiliaTime(now)}. Retomada prevista por volta de ${resumeTime(resumeAt, now)} (aproximadamente ${Math.ceil((resumeAt.getTime() - now.getTime()) / 60_000)} min restantes).`);
    }
  }
}

async function waitOutCloudflareIfNeeded(page) {
  // In headless mode (CI) Cloudflare challenges can't be solved interactively.
  // Wait a short time (10s) in case it resolves via JS challenge; in headed mode
  // give the user up to 90s to solve a CAPTCHA manually.
  const maxWait = headless ? 10_000 : 90_000;
  const started = Date.now();
  while (Date.now() - started < maxWait) {
    const title = await page.title().catch(() => "");
    if (!/cloudflare|attention required/i.test(title)) return;
    await page.waitForTimeout(2500);
  }
  const title = await page.title().catch(() => "");
  if (/cloudflare|attention required/i.test(title)) {
    if (headless) {
      throw new Error(
        `Cloudflare bloqueando em modo headless após ${maxWait / 1000}s (IP de datacenter detectado). Sem resultados para este termo.`
      );
    } else {
      throw new Error(
        `Cloudflare ainda está bloqueando após 90s. Rode sem --headless e, se aparecer desafio/captcha, resolva uma vez no perfil ${USER_DATA_DIR} para persistir cookies.`
      );
    }
  }
}

async function waitForListingReadinessPlaywright(page) {
  const outcome = await page
    .waitForFunction(
      () => {
        const count = document.querySelectorAll("section.olx-adcard").length;
        if (count > 0) return "cards";

        const text = (document.body?.innerText || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();
        if (/(?:^|\n)\s*0\s+resultados?\b|nao encontramos|sem resultados|nenhum resultado/i.test(text)) return "empty";

        return false;
      },
      null,
      { timeout: 6000, polling: 150 }
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null);

  assertOlxAccessible(await page.locator('body').innerText().catch(() => ''));
  if (!outcome) throw new Error('timeout: OLX não apresentou resultados nem confirmação de busca vazia');
  return outcome === "cards";
}

async function collectCardsFromInfiniteScroll(page, maxCards) {
  const results = [], seen = new Set();
  let stableRounds = 0, lastCount = 0, payload = {};
  while (results.length <= maxCards && stableRounds < RAW_STABLE_ROUNDS) {
    payload = await page.evaluate(readOlxListing);
    for (const item of payload.items ?? []) {
      const normalized = normalizeListingCard(item);
      const key = normalized.url ? cardKey(normalized) : null;
      if (normalized.title && normalized.price_brl != null && key && !seen.has(key)) {
        seen.add(key); results.push(normalized);
      }
    }
    stableRounds = results.length === lastCount ? stableRounds + 1 : 0;
    lastCount = results.length;
    if (results.length > maxCards || (Number.isFinite(payload.totalResults) && results.length >= payload.totalResults)
      || !(payload.items?.length)) break;
    await page.mouse.wheel(0, 2200);
    await waitForCardCountChangePlaywright(page, results.length);
  }
  return finishOlxListing(results, maxCards, payload);
}

async function waitForCardCountChangePlaywright(page, previousCount) {
  await page
    .waitForFunction(
      (count) =>
        document.querySelectorAll("section.olx-adcard").length > count ||
        window.scrollY + window.innerHeight >= document.body.scrollHeight - 20,
      previousCount,
      { timeout: 1400, polling: 100 }
    )
    .catch(() => {});
}

async function enrichAd(listingPage, card) {
  const url = card.url;
  const page = await listingPage.context().newPage();
  try {
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    const bodyLocator = page.locator("body");
    await bodyLocator.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    await page
      .waitForFunction(() => (document.body?.innerText?.length || 0) > 800, null, {
        timeout: 15000,
        polling: 150,
      })
      .catch(() => {});
    const detail = await page.evaluate(readOlxNotebookDetail);
    return {
      ...validateOlxNotebook(listingCardToItem(card), detail),
      id: extractOlxId(card.url), url: card.url, title: card.title,
      location: extractLocationFromText(detail.body_text), condition: extractConditionFromText(detail.body_text),
      status: "active", first_seen: null, last_seen: null, notes: null,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function extractLocationFromText(text) {
  const t = (text ?? "").toString();
  const m = t.match(/([^\n]{0,80}?,\s*[^\n]{0,80}?\s*-\s*[A-Z]{2})/);
  return m ? m[1].trim() : null;
}

function extractConditionFromText(text) {
  const t = (text ?? "").toString();
  const m = t.match(/\b(Usado\s*-\s*[^\n]{0,40}|Novo)\b/i);
  return m ? m[1].trim() : null;
}

function buildReport({ runDate, snapshot, previousSnapshot, priceMin, priceMax }) {
  const currentItems = snapshot.items.filter((x) => x.status === "active" && isValidatedOlxItem(x));
  const pending = snapshot.items.filter(x => x.status === 'active' && !isValidatedOlxItem(x)
    && (x.ram_gb == null || x.ram_gb >= NOTEBOOK_MIN_RAM_GB)
    && x.validation?.state !== 'rejected' && x.price_brl >= priceMin && x.price_brl <= priceMax);
  const rejected = snapshot.items.filter(x => x.validation?.state === 'rejected');
  const inRange = currentItems.filter((x) => x.price_brl != null && x.price_brl >= priceMin && x.price_brl <= priceMax);

  const previousById = new Map((previousSnapshot?.items ?? []).map((x) => [x.id ?? x.url, x]));

  const wasValidated = item => item?.validation?.state === 'validated' && isValidatedOlxItem(item);
  const newItems = inRange.filter((x) => !wasValidated(previousById.get(x.id ?? x.url)));
  const stillActiveSeen = inRange.filter((x) => wasValidated(previousById.get(x.id ?? x.url)));

  // Listing-based crawler: absence only means "not seen in this run's listing results" (not necessarily offline).
  const notSeenThisRun = (previousSnapshot?.items ?? [])
    .filter((x) => x.status === "active" && isValidatedOlxItem(x))
    .filter((x) => !snapshot.items.some(item => (item.id ?? item.url) === (x.id ?? x.url) && item.status === 'active'));

  const priceChanges = [];
  for (const item of currentItems) {
    const prev = previousById.get(item.id ?? item.url);
    if (!isValidatedOlxItem(prev)) continue;
    if (item.price_brl != null && item.price_brl > PRICE_CHANGE_MAX_BRL) continue;
    if (prev.price_brl != null && item.price_brl != null && prev.price_brl !== item.price_brl) {
      priceChanges.push({ item, from: prev.price_brl, to: item.price_brl });
    }
  }

  const lines = [];
  lines.push(`# Monitor OLX notebooks por CPU — ${runDate}`);
  lines.push("");
  lines.push("## Resumo executivo");
  lines.push(`- RAM mínima instalada: **${NOTEBOOK_MIN_RAM_GB} GB**.`);
  lines.push('- Armazenamento não informado não impede a oferta; CPU permitida, RAM e preço continuam obrigatórios.');
  if (snapshot.run?.successful_terms) {
    lines.push(`- Cobertura parcial: **${snapshot.run.partial ? "sim" : "não"}**`);
    lines.push(`- Coleta em andamento: **${snapshot.run.in_progress ? "sim" : "não"}**`);
    lines.push(`- Termos concluídos: **${snapshot.run.successful_terms.length}/${snapshot.run.scheduled_coverage.length}**`);
    lines.push(`- Termos com falha: **${snapshot.run.failed_terms.length}**`);
    lines.push(`- Termos não consultados: **${snapshot.run.unattempted_terms.length}**`);
    lines.push(`- Consultas adiadas por frequência ou orçamento: **${snapshot.run.deferred_coverage?.length ?? 0}**`);
  }
  if (snapshot.run?.description_discovery) {
    const d = snapshot.run.description_discovery;
    lines.push(`- Consultas adicionais de descrição: **${d.extra_details}/${d.per_round_limit}**; tempo: **${Math.round(d.detail_ms / 1000)} s**; ofertas válidas recuperadas: **${d.recovered_validated}**.`);
    lines.push(`- Total de detalhes reservados: **${d.total_details ?? 0}/${d.total_detail_limit ?? 12}**.`);
    lines.push(`- Candidatos aguardando descrição: **${d.queued_candidates}**. Validação da fila completa: **${d.validation_complete ? 'sim' : 'não'}**.`);
  }
  lines.push(`- Novos anúncios válidos (R$ ${priceMin.toLocaleString("pt-BR")}–R$ ${priceMax.toLocaleString("pt-BR")}): **${newItems.length}**`);
  lines.push(`- Anúncios ainda ativos (já vistos) no range: **${stillActiveSeen.length}**`);
  lines.push(`- Não vistos nesta rodada (sumiram da listagem): **${notSeenThisRun.length}**`);
  lines.push(`- Alterações de preço detectadas: **${priceChanges.length}**`);
  lines.push(`- Candidatos pendentes de conferência na faixa: **${pending.length}**`);
  lines.push(`- Anúncios rejeitados pela validação: **${rejected.length}**`);
  lines.push('- Validado significa leitura automática do anúncio; não comprova autenticidade, estado físico ou entrega.');
  if (snapshot.run?.policy_reclassification) lines.push(`- Reclassificação dos dados salvos; sem nova visita aos anúncios. Coleta original: ${snapshot.run.completed_at}.`);
  const references = inRange.filter(item => item.opportunity?.state === 'indicative');
  if (references.length) {
    for (const item of references) lines.push(`- Referência indicativa: ${item.title}: ${item.opportunity.difference_percent}% abaixo da mediana de ${item.opportunity.sample} comparáveis; frete, TGP e estado físico exigem conferência.`);
  } else lines.push('- Comparação de preço: amostra insuficiente de configurações semelhantes para classificar oportunidades.');
  lines.push("");

  if (snapshot.run?.failed_terms?.length) {
    lines.push("## Falhas parciais", ...snapshot.run.failed_terms.map((failure) => `- ${failure.term}: ${failure.error}`), "");
  }
  if (snapshot.run?.in_progress) {
    lines.push("## Progresso salvo", "- Este relatório contém um lote intermediário. A coleta ainda não terminou; os anúncios dos termos sem cobertura foram preservados.", "");
  }

  lines.push(`## Novos anúncios (R$ ${priceMin.toLocaleString("pt-BR")}–R$ ${priceMax.toLocaleString("pt-BR")})`);
  if (newItems.length === 0) {
    lines.push("- Nenhum.");
  } else {
    for (const item of newItems.sort((a, b) => (a.price_brl ?? 0) - (b.price_brl ?? 0))) {
      lines.push(formatItemLine(item));
    }
  }
  lines.push("");

  lines.push("## Anúncios ainda ativos (já vistos) no range");
  if (stillActiveSeen.length === 0) {
    lines.push("- Nenhum.");
  } else {
    for (const item of stillActiveSeen.sort((a, b) => (a.price_brl ?? 0) - (b.price_brl ?? 0))) {
      lines.push(formatItemLine(item));
    }
  }
  lines.push("");

  if (priceChanges.length > 0) {
    lines.push("## Mudanças de preço");
    for (const change of priceChanges.sort((a, b) => (a.to ?? 0) - (b.to ?? 0))) {
      lines.push(formatPriceChangeLine(change));
    }
    lines.push("");
  }

  if (notSeenThisRun.length > 0) {
    lines.push("## Não vistos nesta rodada (sumiram da listagem)");
    lines.push("- Observação: como a coleta é por listagem e limitada por CPU, isso **não garante** que o anúncio foi removido da OLX; apenas que não apareceu nos resultados coletados desta execução.");
    for (const item of notSeenThisRun.sort((a, b) => (a.price_brl ?? 0) - (b.price_brl ?? 0))) {
      lines.push(`- ${item.title} (${item.cpu_term}) — ${item.url}`);
    }
    lines.push("");
  }

  if (pending.length) {
    lines.push('## Candidatos pendentes de conferência', '- Estes candidatos não entram nos alertas de ofertas válidas.');
    for (const item of pending) lines.push(`${formatItemLine(item)} — Pendente: ${(item.validation?.reasons ?? ['Precisa de nova leitura']).join('; ')}`);
    lines.push('');
  }
  if (rejected.length) {
    lines.push('## Anúncios rejeitados');
    for (const item of rejected) lines.push(`- ${item.title} — ${(item.validation.reasons ?? []).join('; ')} — ${item.url}`);
  }
  return lines.join("\n");
}

function formatItemLine(item) {
  return `- R$ ${item.price_brl.toLocaleString("pt-BR")} — ${formatItemDetails(item)}`;
}

function formatPriceChangeLine(change) {
  return `- R$ ${change.from.toLocaleString("pt-BR")} → R$ ${change.to.toLocaleString("pt-BR")} — ${formatItemDetails(change.item)}`;
}

function formatItemDetails(item) {
  const ram = item.ram_gb ? `${item.ram_gb} GB RAM` : "RAM n/d";
  const storage = item.storage_gb ? `${item.storage_gb} GB` : "SSD/HD n/d";
  const gpu = item.gpu ? `GPU ${item.gpu}` : "GPU n/d";
  const location = item.location ? ` — ${item.location}` : "";
  return `${item.title} (${item.cpu_term}) — ${ram} / ${storage} / ${gpu}${location} — ${item.url}`;
}

function mergeWithPreviousSnapshot({ runDate, now, collected, previousSnapshot, successfulTerms, failedTerms = [], scheduledTerms = cpuTerms, run = {} }) {
  if (successfulTerms) {
    const result = mergeMonitorSnapshot({
      previousSnapshot, collected, now,
      run: { timezone: "America/Sao_Paulo", ...run },
      scheduledCoverage: scheduledTerms,
      successfulCoverage: successfulTerms,
      failedCoverage: failedTerms.filter(failure=>failure.kind!=='deferred').map((failure) => failure.term),
      configuredCoverage: [...new Set([...DEFAULT_CPU_TERMS,...OLX_NOTEBOOK_FAMILIES.map(spec=>spec.id),...configuredSearches])],
      itemCoverage: (item) => item.search_terms?.length ? item.search_terms : item.cpu_term ? [item.cpu_term]
        : DEFAULT_CPU_TERMS.filter((term) => textContainsCpuTerm(item.title ?? "", term)),
      filters: { ram_gb: { min: NOTEBOOK_MIN_RAM_GB }, price_brl: { min: PRICE_MIN_BRL, max: PRICE_MAX_BRL } },
    });
    result.price_range_brl = { min: PRICE_MIN_BRL, max: PRICE_MAX_BRL };
    result.items = result.items.map(item => item.validation?.state === 'rejected'
      ? { ...item, status: 'out_of_scope', out_of_scope_at: item.out_of_scope_at ?? now.toISOString() } : item);
    result.items = result.items.map(revalidateSavedOlxItem);
    const comparable = result.items.filter(item => item.status === 'active' && isValidatedOlxItem(item));
    result.items = result.items.map(item => isValidatedOlxItem(item) ? { ...item, opportunity: notebookOpportunity(item, comparable) } : item);
    return result;
  }
  return _mergeItems({
    runDate,
    now,
    collected,
    previousSnapshot,
    priceMin: PRICE_MIN_BRL,
    priceMax: PRICE_MAX_BRL,
  });
}

export { mergeWithPreviousSnapshot, getReusablePreviousEnrichedItem, needsDetailEnrichment, buildReport };

function hasExcludedKeyword(text) {
  return Boolean(notebookExclusionReason(text));
}



async function getLatestSnapshotPath(root) {
  try {
    const entries = await fs.readdir(root);
    const snapshots = entries
      .filter((name) => /^snapshot-\d{4}-\d{2}-\d{2}/.test(name) && name.endsWith(".json"))
      .sort()
      .reverse();
    if (snapshots.length === 0) return null;
    return path.join(root, snapshots[0]);
  } catch {
    return null;
  }
}

async function readJsonSafe(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getOptionValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}
