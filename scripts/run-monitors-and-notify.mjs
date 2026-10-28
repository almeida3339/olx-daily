import { filterNotebookReportRam } from './lib/notebook-policy.mjs';
import { staleEnjoeiJobs } from './lib/enjoei-recovery.mjs';
import { buildCollectionSummary, collectionSummaryLine } from './lib/collection-summary.mjs';
import { buildMonitorHealth, collectionHealthAlerts } from './lib/monitor-health.mjs';
import { filterOledReport } from './lib/oled-monitor-scope.mjs';
import { filterBarefootReport } from './lib/shoe-search-rules.mjs';
import { ENJOEI_JAPANESE_JEANS } from './lib/enjoei-japanese-jeans.mjs';
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import { sendWhatsApp } from "./lib/whatsapp-client.mjs";
import {
  buildDeliveryStatus,
  buildPriorFailureNote,
  reconcilePendingFailures,
  mergePendingFailures,
  sanitizeErrorMessage,
  mergeAcks
} from "./lib/notification-status.mjs";
import { createMonitorLogger } from "./lib/monitor-logger.mjs";
import { classifyMonitorError } from "./lib/monitor-errors.mjs";
import { runMonitorProcess } from "./lib/monitor-process.mjs";
import { appendMonitorHistory } from "./lib/monitor-history.mjs";
import {
  enqueueNotification,
  claimNotification,
  notificationDedupeKey,
  readyNotificationItems,
  skipNotification,
  recoverAbandonedNotifications,
  reconcileNotificationOutbox,
  settleNotification,
} from "./lib/notification-outbox.mjs";
import { readLatestCommittedReport, readLatestValidSnapshot, writeJsonAtomic } from "./lib/monitor-runtime.mjs";
import {
  MERCADOLIVRE_WATCHLISTS,
  ALL_WATCHLISTS,
  getWatchlist,
  resolveAutomationDataDir,
  automationChildEnvironment,
  resolveWatchlistDataDir,
} from "./lib/watchlists-registry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..");
function getStatusFilePath() {
  const source = process.env.GITHUB_ACTIONS === "true" ? "ci" : "local";
  return path.join(workspaceRoot, "data", "status", `latest-${source}.json`);
}

let fsApi = fs;
let sourceSummaries = new Map();
let reportReadErrors = new Map();
let runCommandFn = (...args) => runCommand(...args);

// ML uses repository data and has no standalone automation fallback directory.
const localDir = (id) => id.startsWith('mercadolivre-')
  ? resolveWatchlistDataDir(workspaceRoot, id) : resolveAutomationDataDir(workspaceRoot, id);
const OLX_DIR              = localDir("olx");
const ENJOEI_DIR           = localDir("enjoei");
const ENJOEI_NOTEBOOKS_DIR = localDir("enjoei-notebooks");
const ENJOEI_ZEGNA_DIR = localDir("enjoei-zegna");
const ENJOEI_RICARDO_ALMEIDA_DIR = localDir("enjoei-ricardo-almeida");
const ENJOEI_JACOB_COHEN_DIR = localDir("enjoei-jacob-cohen");
const ENJOEI_BRUNELLO_CUCINELLI_DIR = localDir("enjoei-brunello-cucinelli");
const DOCKSTATIONS_DIR     = localDir("dockstations");
const FITBIT_DIR           = localDir("fitbit");
const LIFEFACTORY_DIR      = localDir("lifefactory");
const TELA_BOOK3_DIR       = localDir("tela-galaxybook3");
const MELANGER_DIR         = localDir("melanger");
const BUDS4PRO_DIR         = localDir("galaxy-buds4-pro");
const ONEPLUS_BUDS_DIR     = localDir("oneplus-buds-pro-3");
const PIXEL_WATCH4_DIR     = localDir("google-pixel-watch-4");
const PIXEL_WATCH5_DIR     = localDir("google-pixel-watch-5");
const OURA_DIR             = localDir("oura-ring5");
const OLED_MONITORES_DIR   = localDir("oled-monitores");
const MERCADOLIVRE_DIRS = MERCADOLIVRE_WATCHLISTS.filter((watchlist) => !watchlist.paused).map((watchlist) => [
  watchlist.healthLabel ?? watchlist.label,
  resolveWatchlistDataDir(workspaceRoot, watchlist),
]);

// NUNCA usar defaults hardcoded para credenciais: este repositório é público
// (GitHub Pages) e qualquer valor aqui vaza para o mundo. As variáveis são
// obrigatórias e validadas no ponto de uso (sendEmail/sendWhatsApp).
const GMAIL_USER         = process.env.GMAIL_USER;
// App passwords do Gmail são 16 caracteres sem espaços. O Google exibe a senha
// no formato "xxxx xxxx xxxx xxxx"; se ela for colada com os espaços, o AUTH do
// SMTP rejeita com "535-5.7.8 Username and Password not accepted" (a regra de
// "espaços são ignorados" só vale no login web, não no SMTP). Remover qualquer
// espaço em branco torna a leitura robusta independentemente de como foi salva.
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
const NOTIFY_TO          = process.env.NOTIFY_EMAIL_TO ?? GMAIL_USER;
// Canal de email desativado a pedido do usuário (credencial SMTP vinha sendo
// rejeitada — 535-5.7.8 — e enchendo a fila de pendências sem entregar nada).
// Não removemos o código de envio: só paramos de enfileirar. Reativar é setar
// NOTIFY_EMAIL_DISABLED=0 depois de trocar a senha de app do Gmail no secret
// GMAIL_APP_PASSWORD. A leitura por rodada também mantém os testes isolados.
const emailNotificationsDisabled = () => process.env.NOTIFY_EMAIL_DISABLED !== "0";
// As variáveis de linha de comando agora são interpretadas dinamicamente dentro de main()

// Se executado diretamente, roda o main. Caso contrário, exporta para testes.
import { fileURLToPath as urlToPath } from "node:url";
const isMain = process.argv[1] === urlToPath(import.meta.url);
if (isMain) {
  main().catch((err) => { console.error(`Falha geral: ${sanitizeErrorMessage(err?.message ?? err)}`); process.exitCode = 1; });
}

export async function main({
  runCommandFn: runCommandIn = runCommand,
  sendEmailFn = sendEmail,
  sendWhatsAppFn = sendWhatsApp,
  fsApi: fsApiIn = fs,
  nowFn = () => new Date(),
  args = process.argv
} = {}) {
  const prevFsApi = fsApi;
  const previousSummaries = sourceSummaries, previousReadErrors = reportReadErrors;
  sourceSummaries = new Map(); reportReadErrors = new Map();
  const prevRunCommandFn = runCommandFn;
  const priorTrafficRun = process.env.OLX_TRAFFIC_RUN_ID;
  fsApi = fsApiIn;
  runCommandFn = runCommandIn;

  try {
    const forceEmail         = args.includes("--force-email");
    const skipMonitors       = args.includes("--skip-monitors");
    const dryRun             = args.includes("--dry-run");
    const onlyOlx            = args.includes("--only-olx");
    const onlyMercadoLivre   = args.includes("--only-mercadolivre");
    const skipOlx            = args.includes("--skip-olx") || process.env.SKIP_OLX === "1";
    const skipEnjoei         = args.includes("--skip-enjoei") || process.env.SKIP_ENJOEI === "1";
    const skipDockstations   = (getWatchlist('dockstations').paused && !args.includes('--include-paused'))
      || args.includes("--skip-dockstations") || process.env.SKIP_DOCKSTATIONS === "1";
    const skipFitbit         = (getWatchlist('fitbit').paused && !args.includes('--include-paused')) || args.includes("--skip-fitbit") || process.env.SKIP_FITBIT === "1";
    const skipLifefactory    = args.includes("--skip-lifefactory") || process.env.SKIP_LIFEFACTORY === "1";
    const skipTelaBook3      = args.includes("--skip-tela-book3") || process.env.SKIP_TELA_BOOK3 === "1";
    const skipMelanger       = args.includes("--skip-melanger") || process.env.SKIP_MELANGER === "1";
    const skipBuds4Pro       = !args.includes("--include-paused")
      || args.includes("--skip-buds4-pro") || process.env.SKIP_BUDS4_PRO === "1";
    const skipOnePlusBuds    = args.includes("--skip-oneplus-buds") || process.env.SKIP_ONEPLUS_BUDS === "1";
    const skipPixelWatch4    = (getWatchlist('google-pixel-watch-4').paused && !args.includes('--include-paused')) || args.includes("--skip-pixel-watch-4") || process.env.SKIP_PIXEL_WATCH4 === "1";
    const skipPixelWatch5    = (getWatchlist('google-pixel-watch-5').paused && !args.includes('--include-paused')) || args.includes("--skip-pixel-watch-5") || process.env.SKIP_PIXEL_WATCH5 === "1";
    const skipOura           = (getWatchlist('oura-ring5').paused && !args.includes('--include-paused')) || args.includes("--skip-oura") || process.env.SKIP_OURA === "1";
    const skipOledMonitores  = args.includes("--skip-oled-monitores") || process.env.SKIP_OLED_MONITORES === "1";
    const skipMercadoLivre   = args.includes("--skip-mercadolivre")
      || process.env.SKIP_MERCADOLIVRE === "1"
      || process.env.GITHUB_ACTIONS === "true";
    const olxMaxPerCpu       = getArgValue("--olx-max-per-cpu", args) ?? process.env.OLX_MAX_PER_CPU ?? "12";
    const reportMinTimeArg   = getArgValue("--report-min-time", args) ?? process.env.MONITOR_REPORT_MIN_TIME;

    const runNow = nowFn();
    const runStart = runNow.getTime();
    const logger = createMonitorLogger({ monitor: "orchestrator" });
    process.env.OLX_TRAFFIC_RUN_ID = logger.runId;
  console.log(`Iniciando rodada: ${new Date().toISOString()}`);
  logger.start({ only_mercadolivre: onlyMercadoLivre, skip_monitors: skipMonitors });
  const errors = [];
  const monitorOutcomes = [];
  const recoverEnjoei = args.includes('--recover-stale-enjoei') && onlyOlx && !onlyMercadoLivre
    && !skipMonitors && !skipEnjoei && (await staleEnjoeiJobs(workspaceRoot)).length > 0;

  if (skipMonitors) {
    console.log("--skip-monitors ativo: usando relatórios existentes.");
  } else if (onlyMercadoLivre) {
    console.log("--only-mercadolivre ativo: sem coleta de outros monitores.");
  } else {
    console.log("Rodando monitores em fila...");
    // Cada job de watchlist (dockstations, fitbit, lifefactory, tela-book3,
    // melanger, buds4-pro, oneplus-buds, pixel-watch-4/5, oura, oled-monitores)
    // e o job "olx" (notebooks por CPU) abrem sua PRÓPRIA instância de Chromium
    // (perfil isolado) e cada um faz Enjoei e DEPOIS OLX, nessa ordem. Rodar
    // vários concorrentes satura CPU/rede da máquina (derrubava navegações por
    // timeout — incidente ao somar o 9º job concorrente) E significa várias
    // sessões de Chrome distintas batendo na OLX ao mesmo tempo, o que a OLX lê
    // como tráfego automatizado e passou a bloquear (relatado pelo usuário em
    // 24/09). Concorrência 1 (OLX_JOB_CONCURRENCY, default 1) elimina as duas
    // causas: só um job por vez ocupa Chrome/rede, e só uma sessão por vez
    // conversa com a OLX — nunca duas em paralelo. Custo: a rodada toda demora
    // mais (soma dos jobs em vez de dividida por 3); os jobs Enjoei (API, sem
    // Chrome) seguem irrestritos, sem impacto nisso.
    const browserJobConcurrency = Number(process.env.OLX_JOB_CONCURRENCY) || 1;
    const jobs = [];
    if (recoverEnjoei) jobs.push(['enjoei-recovery', () => runScript('recover-enjoei.mjs', ['--stale-only']), false]);
    if (!skipOlx) jobs.push(["olx", () => runOlxMonitor(olxMaxPerCpu), true]);
    else console.log("OLX pulado nesta rodada.");
    if (!onlyOlx && !skipEnjoei) {
      jobs.push(["enjoei-tenis", () => runScript("monitor-enjoei-tenis.mjs", []), false]);
      jobs.push(["enjoei-notebooks", () => runScript("monitor-enjoei-notebooks.mjs", []), false]);
      jobs.push(["enjoei-zegna", () => runScript("monitor-enjoei-zegna.mjs", []), false]);
      jobs.push(["enjoei-ricardo-almeida", () => runScript("monitor-enjoei-ricardo-almeida.mjs", []), false]);
      jobs.push(["enjoei-jacob-cohen", () => runScript("monitor-enjoei-jacob-cohen.mjs", []), false]);
      jobs.push(["enjoei-brunello-cucinelli", () => runScript("monitor-enjoei-brunello-cucinelli.mjs", []), false]);
      jobs.push(["enjoei-japanese-jeans", () => runScript("monitor-enjoei-japanese-jeans.mjs", []), false]);
    }
    // Dockstations combina OLX (Playwright) + Enjoei (API) num único script e
    // trata falhas de cada fonte internamente, então roda independente dos flags
    // only-olx/skip-enjoei (assim funciona tanto no Task Scheduler local quanto no CI).
    if (!skipDockstations) jobs.push(["dockstations", () => runScript("monitor-dockstations.mjs", args.includes('--include-paused')?['--include-paused']:[]), true]);
    if (!skipFitbit) jobs.push(["fitbit", () => runScript("monitor-fitbit.mjs", args.includes("--include-paused") ? ["--include-paused"] : []), true]);
    if (!skipLifefactory) jobs.push(["lifefactory", () => runScript("monitor-lifefactory.mjs", []), true]);
    if (!skipTelaBook3) jobs.push(["tela-book3", () => runScript("monitor-tela-galaxybook3.mjs", []), true]);
    if (!skipMelanger) jobs.push(["melanger", () => runScript("monitor-melanger.mjs", []), true]);
    if (!skipBuds4Pro) jobs.push(["buds4-pro", () => runScript("monitor-galaxy-buds4-pro.mjs", ["--include-paused"]), true]);
    else console.log("Galaxy Buds4 Pro pausado; busca local nao executada.");
    if (!skipOnePlusBuds) jobs.push(["oneplus-buds", () => runScript("monitor-oneplus-buds-pro-3.mjs", []), true]);
    if (!skipPixelWatch4) jobs.push(["pixel-watch-4", () => runScript("monitor-google-pixel-watch-4.mjs", args.includes("--include-paused") ? ["--include-paused"] : []), true]);
    if (!skipPixelWatch5) jobs.push(["pixel-watch-5", () => runScript("monitor-google-pixel-watch-5.mjs", args.includes("--include-paused") ? ["--include-paused"] : []), true]);
    if (!skipOura) jobs.push(["oura", () => runScript("monitor-oura-ring5.mjs", args.includes("--include-paused") ? ["--include-paused"] : []), true]);
    if (!skipOledMonitores) jobs.push(["oled-monitores", () => runScript("monitor-oled-monitores.mjs", []), true]);
    // Mercado Livre NÃO roda aqui: é desacoplado do fluxo do OLX/Enjoei (que
    // espera todos os jobs antes de publicar). O ML é pesado/lento e roda sob
    // demanda via `npm run monitor:mercadolivre` ou o atalho da barra de tarefas
    // (run-mercadolivre-and-publish.ps1), que coleta e publica por conta própria.

    const results = await runJobsWithBrowserLimit(jobs, browserJobConcurrency);
    for (let i = 0; i < jobs.length; i += 1) {
      const [name] = jobs[i];
      const result = results[i];
      if (result.status !== "rejected") {
        const outcome = result.value ?? { status: 'success' };
        monitorOutcomes.push({ source: name, ...outcome });
        if (['partial','deferred'].includes(outcome.status)) {
          logger.info(`monitor_${outcome.status}`, { source: name, ...outcome });
          console.log(`${name}: ${outcome.status === 'partial' ? 'cobertura parcial por limite previsto' : 'consultas adiadas'}; resultados preservados.`);
          continue;
        }
        logger.info("monitor_succeeded", { source: name });
        continue;
      }
      const monitorError = sanitizeErrorMessage(result.reason?.message ?? result.reason);
      if (name === 'enjoei-recovery') errors.push(`Recuperação Enjoei: ${monitorError}`);
      monitorOutcomes.push({ source: name, status: result.reason?.operational?.status ?? 'failed', reasons: [monitorError] });
      if (name === "olx") { console.error(`OLX falhou: ${monitorError}`); errors.push(`OLX: ${monitorError}`); }
      if (name === "enjoei-tenis") { console.error(`Enjoei tênis falhou: ${monitorError}`); errors.push(`Enjoei tênis: ${monitorError}`); }
      if (name === "enjoei-notebooks") { console.error(`Enjoei NB falhou: ${monitorError}`); errors.push(`Enjoei NB: ${monitorError}`); }
      if (name === "enjoei-zegna") { console.error(`Enjoei Zegna falhou: ${monitorError}`); errors.push(`Enjoei Zegna: ${monitorError}`); }
      if (name === "enjoei-ricardo-almeida") { console.error(`Enjoei Ricardo Almeida falhou: ${monitorError}`); errors.push(`Enjoei Ricardo Almeida: ${monitorError}`); }
      if (name === "enjoei-jacob-cohen") errors.push(`Enjoei Jacob Cohën: ${monitorError}`);
      if (name === "enjoei-brunello-cucinelli") errors.push(`Enjoei Brunello Cucinelli: ${monitorError}`);
      if (name === "enjoei-japanese-jeans") errors.push(`Enjoei Jeans japoneses: ${monitorError}`);
      if (name === "dockstations") { console.error(`Dockstations falhou: ${monitorError}`); errors.push(`Dockstations: ${monitorError}`); }
      if (name === "fitbit") { console.error(`Fitbit falhou: ${monitorError}`); errors.push(`Fitbit: ${monitorError}`); }
      if (name === "lifefactory") { console.error(`Lifefactory falhou: ${monitorError}`); errors.push(`Lifefactory: ${monitorError}`); }
      if (name === "tela-book3") { console.error(`Tela Book3 falhou: ${monitorError}`); errors.push(`Tela Book3: ${monitorError}`); }
      if (name === "melanger") { console.error(`Melanger falhou: ${monitorError}`); errors.push(`Melanger: ${monitorError}`); }
      if (name === "buds4-pro") { console.error(`Galaxy Buds4 Pro falhou: ${monitorError}`); errors.push(`Galaxy Buds4 Pro: ${monitorError}`); }
      if (name === "oneplus-buds") { console.error(`OnePlus Buds Pro 3 falhou: ${monitorError}`); errors.push(`OnePlus Buds Pro 3: ${monitorError}`); }
      if (name === "pixel-watch-4") { console.error(`Google Pixel Watch 4 falhou: ${monitorError}`); errors.push(`Google Pixel Watch 4: ${monitorError}`); }
      if (name === "pixel-watch-5") { console.error(`Google Pixel Watch 5 falhou: ${monitorError}`); errors.push(`Google Pixel Watch 5: ${monitorError}`); }
      if (name === "oura") { console.error(`Oura Ring 5 falhou: ${monitorError}`); errors.push(`Oura Ring 5: ${monitorError}`); }
      if (name === "oled-monitores") { console.error(`Monitores OLED falhou: ${monitorError}`); errors.push(`Monitores OLED: ${monitorError}`); }
      logger.error("monitor_failed", result.reason, { source: name });
    }
  }

  // Só apresentamos relatórios DESTA rodada. Se um monitor falhou e não escreveu
  // relatório novo, readLatestReport(dir, minTime) devolve null em vez do relatório
  // antigo — evita reapresentar/realertar achados de rodadas anteriores. No modo
  // --skip-monitors (reuso de relatórios para teste), não aplicamos o corte.
  const parsedReportMinTime = reportMinTimeArg ? Date.parse(reportMinTimeArg) : null;
  const reportMinTime = Number.isFinite(parsedReportMinTime)
    ? parsedReportMinTime
    : (skipMonitors ? null : runStart);
  const enjoeiOn = (!onlyOlx || recoverEnjoei) && !onlyMercadoLivre && !skipEnjoei;
  const zegnaReport = enjoeiOn ? await readLatestReport(ENJOEI_ZEGNA_DIR, reportMinTime).catch(() => null) : null;
  const ricardoAlmeidaReport = enjoeiOn ? await readLatestReport(ENJOEI_RICARDO_ALMEIDA_DIR, reportMinTime).catch(() => null) : null;
  const jacobCohenReport = enjoeiOn ? await readLatestReport(ENJOEI_JACOB_COHEN_DIR, reportMinTime).catch(() => null) : null;
  const brunelloCucinelliReport = enjoeiOn ? await readLatestReport(ENJOEI_BRUNELLO_CUCINELLI_DIR, reportMinTime).catch(() => null) : null;
  const japaneseJeansReports = enjoeiOn ? await Promise.all(ENJOEI_JAPANESE_JEANS.map(async spec => ({
    label: spec.label, report: await readLatestReport(localDir(spec.id), reportMinTime).catch(() => null),
    newRe: /Novos produtos:\s*\*\*(\d+)\*\*/, newSec: "## Novos produtos", priceSec: "## Mudanças de preço",
  }))) : [];
  const [olxStd, enjoeiReport, enjoeiNbStd, dockReport, fitbitReport, lifefactoryReport, telaBook3Report, melangerReport, buds4ProReport, onePlusBudsReport, pixelWatch4Report, pixelWatch5Report, ouraReport, oledMonitoresReport] = await Promise.all([
    skipOlx || onlyMercadoLivre ? null : readLatestReport(OLX_DIR, reportMinTime).catch(() => null),
    enjoeiOn         ? readLatestReport(ENJOEI_DIR, reportMinTime).catch(() => null) : null,
    enjoeiOn         ? readLatestReport(ENJOEI_NOTEBOOKS_DIR, reportMinTime).catch(() => null) : null,
    skipDockstations || onlyMercadoLivre ? null : readLatestReport(DOCKSTATIONS_DIR, reportMinTime).catch(() => null),
    skipFitbit || onlyMercadoLivre       ? null : readLatestReport(FITBIT_DIR, reportMinTime).catch(() => null),
    skipLifefactory || onlyMercadoLivre  ? null : readLatestReport(LIFEFACTORY_DIR, reportMinTime).catch(() => null),
    skipTelaBook3 || onlyMercadoLivre    ? null : readLatestReport(TELA_BOOK3_DIR, reportMinTime).catch(() => null),
    skipMelanger || onlyMercadoLivre     ? null : readLatestReport(MELANGER_DIR, reportMinTime).catch(() => null),
    skipBuds4Pro || onlyMercadoLivre     ? null : readLatestReport(BUDS4PRO_DIR, reportMinTime).catch(() => null),
    skipOnePlusBuds || onlyMercadoLivre  ? null : readLatestReport(ONEPLUS_BUDS_DIR, reportMinTime).catch(() => null),
    skipPixelWatch4 || onlyMercadoLivre  ? null : readLatestReport(PIXEL_WATCH4_DIR, reportMinTime).catch(() => null),
    skipPixelWatch5 || onlyMercadoLivre  ? null : readLatestReport(PIXEL_WATCH5_DIR, reportMinTime).catch(() => null),
    skipOura || onlyMercadoLivre         ? null : readLatestReport(OURA_DIR, reportMinTime).catch(() => null),
    skipOledMonitores || onlyMercadoLivre ? null : readLatestReport(OLED_MONITORES_DIR, reportMinTime).catch(() => null),
  ]);

  // Include coverage limits even when reusing an existing report. A successful
  // HTTP request does not mean that all pages/descriptions were collected.
  if (enjoeiNbStd?.includes("## Cobertura incompleta") && !errors.some((error) => error.startsWith("Enjoei NB:"))) {
    const pending = enjoeiNbStd.match(/- Termos com páginas\/detalhes pendentes[^:]*:\s*([^\n]+)/)?.[1]
      ?? enjoeiNbStd.match(/- Termos truncados[^:]*:\s*([^\n]+)/)?.[1]
      ?? "consulte o relatório";
    errors.push(`Enjoei NB: busca incompleta; páginas/detalhes pendentes: ${pending}`);
  }

  // Cada fonte conta itens NOVOS e ALTERAÇÕES DE PREÇO (antes só contava novos do range padrão).
  const sources = (onlyMercadoLivre ? [] : [
    { label: getWatchlist("olx").label, report: olxStd, newRe: /Novos an[úu]ncios v[aá]lidos[^:]*:\s*\*\*(\d+)\*\*/, newSec: "## Novos anúncios", priceSec: "## Mudanças de preço" },
    { label: getWatchlist("enjoei-notebooks").label, report: enjoeiNbStd, newRe: /Novos notebooks[^:]*:\s*\*\*(\d+)\*\*/, newSec: "## Novos notebooks", priceSec: "## Mudanças de preço" },
    { label: getWatchlist("enjoei").label, report: enjoeiReport, newRe: /Novos produtos:\s*\*\*(\d+)\*\*/, newSec: "## Novos produtos", priceSec: "## Mudancas de preco" },
    { label: getWatchlist("enjoei-zegna").label, report: zegnaReport, newRe: /Novos produtos:\s*\*\*(\d+)\*\*/, newSec: "## Novos produtos", priceSec: "## Mudanças de preço" },
    { label: getWatchlist("enjoei-ricardo-almeida").label, report: ricardoAlmeidaReport, newRe: /Novos produtos:\s*\*\*(\d+)\*\*/, newSec: "## Novos produtos", priceSec: "## Mudanças de preço" },
    { label: getWatchlist("enjoei-jacob-cohen").label, report: jacobCohenReport, newRe: /Novos produtos:\s*\*\*(\d+)\*\*/, newSec: "## Novos produtos", priceSec: "## Mudanças de preço" },
    { label: getWatchlist("enjoei-brunello-cucinelli").label, report: brunelloCucinelliReport, newRe: /Novos produtos:\s*\*\*(\d+)\*\*/, newSec: "## Novos produtos", priceSec: "## Mudanças de preço" },
    ...japaneseJeansReports,
    { label: getWatchlist("dockstations").label, report: dockReport, newRe: /Novos produtos:\s*\*\*(\d+)\*\*/, newSec: "## Novos produtos", priceSec: "## Mudanças de preço" },
    { label: getWatchlist("fitbit").label, report: fitbitReport, newRe: /Novos produtos:\s*\*\*(\d+)\*\*/, newSec: "## Novos produtos", priceSec: "## Mudanças de preço" },
    { label: getWatchlist("lifefactory").label, report: lifefactoryReport, newRe: /Novos produtos:\s*\*\*(\d+)\*\*/, newSec: "## Novos produtos", priceSec: "## Mudanças de preço" },
    { label: getWatchlist("tela-galaxybook3").label, report: telaBook3Report, newRe: /Novos produtos:\s*\*\*(\d+)\*\*/, newSec: "## Novos produtos", priceSec: "## Mudanças de preço" },
    { label: getWatchlist("melanger").label, report: melangerReport, newRe: /Novos produtos:\s*\*\*(\d+)\*\*/, newSec: "## Novos produtos", priceSec: "## Mudanças de preço" },
    { label: getWatchlist("galaxy-buds4-pro").label, report: buds4ProReport, newRe: /Novos produtos:\s*\*\*(\d+)\*\*/, newSec: "## Novos produtos", priceSec: "## Mudanças de preço" },
    { label: getWatchlist("oneplus-buds-pro-3").label, report: onePlusBudsReport, newRe: /Novos produtos:\s*\*\*(\d+)\*\*/, newSec: "## Novos produtos", priceSec: "## Mudanças de preço" },
    { label: getWatchlist("google-pixel-watch-4").label, report: pixelWatch4Report, newRe: /Novos produtos:\s*\*\*(\d+)\*\*/, newSec: "## Novos produtos", priceSec: "## Mudanças de preço" },
    { label: getWatchlist("google-pixel-watch-5").label, report: pixelWatch5Report, newRe: /Novos produtos:\s*\*\*(\d+)\*\*/, newSec: "## Novos produtos", priceSec: "## Mudanças de preço" },
    { label: getWatchlist("oura-ring5").label, report: ouraReport, newRe: /Novos produtos:\s*\*\*(\d+)\*\*/, newSec: "## Novos produtos", priceSec: "## Mudanças de preço" },
    { label: getWatchlist("oled-monitores").label, report: oledMonitoresReport, newRe: /Novos produtos:\s*\*\*(\d+)\*\*/, newSec: "## Novos produtos", priceSec: "## Mudanças de preço" },
  ]).map((s) => ({
    ...s,
    newCount:   extractNewCount(s.report, s.newRe),
    priceCount: extractNewCount(s.report, PRICE_CHANGE_RE),
  }));
  if (!skipMercadoLivre) {
    const mlReports = await Promise.all(MERCADOLIVRE_DIRS.map(([, dir]) =>
      readLatestReport(dir, reportMinTime).catch(() => null)
    ));
    const mlErrors = [];
    for (let index = 0; index < MERCADOLIVRE_DIRS.length; index += 1) {
      const [label] = MERCADOLIVRE_DIRS[index];
      const report = mlReports[index];
      mlErrors.push(...mercadoLivreReportErrors(label, report));
      sources.push({
        label,
        report,
        newRe: /Novos produtos:\s*\*\*(\d+)\*\*/,
        newSec: "## Novos produtos",
        priceSec: "## Mudancas de preco",
        newCount: extractNewCount(report, /Novos produtos:\s*\*\*(\d+)\*\*/),
        priceCount: extractNewCount(report, PRICE_CHANGE_RE),
      });
    }
    // A blocked launch produces no new report. Persist and notify the block
    // instead of presenting an empty collection as a successful search.
    if (onlyMercadoLivre && mlErrors.length === 0) {
      const schedule = await readStatusFile(path.join(workspaceRoot, "data", "status", "mercadolivre-schedule.json"));
      if (schedule?.global?.requires_login) {
        mlErrors.push("Mercado Livre: login necessario no perfil exclusivo; coleta nao executada.");
      } else if (Date.parse(schedule?.global?.blocked_until ?? "") > runStart) {
        mlErrors.push(`Mercado Livre: coleta bloqueada (${schedule.global.block_reason ?? "verificacao"}) ate ${schedule.global.blocked_until}; resolva a verificacao no perfil exclusivo.`);
      }
    }
    errors.push(...mlErrors);
    for (const error of mlErrors) console.error(error);
  }

  if (!onlyMercadoLivre && args.includes('--recover-stale-enjoei')) {
    const collectionHealth = await buildMonitorHealth(workspaceRoot);
    const alerts = collectionHealthAlerts(collectionHealth).filter(alert => alert.automatic);
    for (const alert of alerts) {
      errors.push(alert.message);
      logger.info('collection_health_alert', { group: alert.id, message: alert.message });
    }
  }
  const jobIds = { olx: ['olx'], 'enjoei-tenis': ['enjoei'], 'enjoei-notebooks': ['enjoei-notebooks'],
    'enjoei-zegna': ['enjoei-zegna'], 'enjoei-ricardo-almeida': ['enjoei-ricardo-almeida'],
    'enjoei-jacob-cohen': ['enjoei-jacob-cohen'], 'enjoei-brunello-cucinelli': ['enjoei-brunello-cucinelli'],
    'enjoei-japanese-jeans': ENJOEI_JAPANESE_JEANS.map(spec => spec.id),
    dockstations: ['dockstations'], fitbit: ['fitbit'], lifefactory: ['lifefactory'], 'tela-book3': ['tela-galaxybook3'],
    melanger: ['melanger'], 'buds4-pro': ['galaxy-buds4-pro'], 'oneplus-buds': ['oneplus-buds-pro-3'],
    'pixel-watch-4': ['google-pixel-watch-4'], 'pixel-watch-5': ['google-pixel-watch-5'], oura: ['oura-ring5'], 'oled-monitores': ['oled-monitores'] };
  if (recoverEnjoei) {
    const recovered = await readStatusFile(path.join(workspaceRoot, 'data/status/enjoei-recovery.json'));
    if (Date.parse(recovered?.started_at ?? '') >= runStart) jobIds['enjoei-recovery'] = (recovered.jobs ?? []).flatMap(job => job.ids);
  }
  const expected = new Map(monitorOutcomes.flatMap(outcome => (jobIds[outcome.source] ?? []).map(id => [id, outcome])));
  for (const source of sources) {
    const spec = ALL_WATCHLISTS.find(spec => spec.label === source.label || spec.healthLabel === source.label);
    if (!spec) continue;
    source.id = spec.id;
    const dir = spec.id.startsWith('mercadolivre-') ? resolveWatchlistDataDir(workspaceRoot, spec) : localDir(spec.id);
    source.summary = sourceSummaries.get(dir) ?? null;
    if (source.summary?.findings) {
      source.newCount = source.summary.findings.new_count;
      source.priceCount = source.summary.findings.price_count;
    } else if (source.summary && source.report) {
      // Compatibility for artifacts written before structured findings existed.
      source.summary.findings = { new_count: source.newCount, price_count: source.priceCount, legacy_report: true };
    }
    if (fsApi === fs && (expected.has(spec.id) || reportReadErrors.has(dir)) && !source.report) {
      const reason = reportReadErrors.get(dir) ?? 'nenhum relatório novo e legível nesta rodada';
      const message = `${source.label}: ${reason}`;
      if (!errors.includes(message)) errors.push(message);
      source.summary = { ...(source.summary ?? {}), execution: 'failed', coverage: source.summary?.coverage ?? {}, findings: source.summary?.findings ?? null };
      logger.info('source_summary_missing', { source: spec.id, reason });
    }
  }
  const roundSummary = { schema_version: 1, run_id: logger.runId, started_at: runNow.toISOString(),
    completed_at: new Date().toISOString(), execution: errors.length ? 'failed' : 'success',
    delivery: { whatsapp: 'pending', email: 'pending' },
    sources: sources.filter(source => source.summary || source.report).map(source => ({ id: source.id, label: source.label, summary: source.summary })) };
  const totalNew   = sources.reduce((sum, s) => sum + s.newCount, 0);
  const totalPrice = sources.reduce((sum, s) => sum + s.priceCount, 0);

  console.log("\nResumo desta rodada:");
  for (const s of sources) {
    if (!s.report && !s.summary) continue;
    console.log(`  ${s.summary ? collectionSummaryLine(s) : `${s.label}: ${s.newCount} novo(s), ${s.priceCount} preço(s)`}`);
  }

  // Memória entre rodadas: lê status de ambos os ambientes e reconcilia a fila de falhas pendentes.
  const localStatusFile = path.join(workspaceRoot, "data", "status", "latest-local.json");
  const ciStatusFile    = path.join(workspaceRoot, "data", "status", "latest-ci.json");
  const [localStatus, ciStatus] = await Promise.all([
    readStatusFile(localStatusFile),
    readStatusFile(ciStatusFile),
  ]);

  const priorPending = reconcilePendingFailures(localStatus, ciStatus);
  const priorNote    = buildPriorFailureNote(priorPending);
  let notificationOutbox = recoverAbandonedNotifications(reconcileNotificationOutbox(localStatus, ciStatus), runNow);
  const currentStatus = (process.env.GITHUB_ACTIONS === "true" ? ciStatus : localStatus) ?? {};
  currentStatus.round_summary = roundSummary;
  currentStatus.notification_sent_ids = [...new Set([...(localStatus?.notification_sent_ids ?? []), ...(ciStatus?.notification_sent_ids ?? [])])].slice(-500);
  currentStatus.notification_archive = [...new Map([...(localStatus?.notification_archive ?? []), ...(ciStatus?.notification_archive ?? [])].map((item) => [item.id, item])).values()];

  const subject     = buildSubject(sources, errors);
  const body        = (priorNote ? `> ${priorNote}\n\n` : "") + roundSummary.sources.map(collectionSummaryLine).join('\n') + '\n\n' + buildBody(sources, errors);
  const whatsappMsg = (priorNote ? `${priorNote}\n\n` : "") + buildWhatsAppMessage(sources, errors, roundSummary);

  // WhatsApp sempre (heartbeat de execução).
  // Email quando há novos itens, alterações de preço ou erros (evita caixa cheia com confirmações vazias).
  // NOTIFY_EMAIL_DISABLED corta o canal inteiro, mesmo com --force-email.
  const emailDisabled = emailNotificationsDisabled();
  const sendingEmail = !emailDisabled && (totalNew > 0 || totalPrice > 0 || errors.length > 0 || forceEmail);

  if (dryRun) {
    console.log("\n── DRY-RUN (nada enviado) ──");
    console.log(`Enviaria email? ${sendingEmail ? "sim" : "não"}`);
    console.log(`\nSUBJECT: ${subject}`);
    console.log(`\nWHATSAPP:\n${whatsappMsg}`);
    console.log(`\nEMAIL BODY:\n${body || "(vazio)"}`);
    if (errors.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

  const emailKey = sendingEmail ? notificationDedupeKey("email", { subject, body }) : null;
  const whatsappKey = notificationDedupeKey("whatsapp", { message: whatsappMsg });
  if (sendingEmail) {
    notificationOutbox = enqueueNotification(notificationOutbox, {
      channel: "email",
      payload: { subject, body },
    }, runNow);
  }
  notificationOutbox = enqueueNotification(notificationOutbox, {
    channel: "whatsapp",
    payload: { message: whatsappMsg },
  }, runNow);
  await checkpointNotificationOutbox(notificationOutbox, currentStatus, runNow);

  const deliveryByKey = new Map();
  for (const queued of readyNotificationItems(notificationOutbox, runNow)) {
    if (emailDisabled && queued.channel === "email") {
      notificationOutbox = skipNotification(notificationOutbox, queued.id);
      await checkpointNotificationOutbox(notificationOutbox, currentStatus, runNow);
      logger.info("notification_skipped", { channel: queued.channel, outbox_id: queued.id, reason: "email_disabled" });
      continue;
    }
    notificationOutbox = claimNotification(notificationOutbox, queued.id, runNow);
    await checkpointNotificationOutbox(notificationOutbox, currentStatus, runNow);
    try {
      if (queued.channel === "email") await sendEmailFn(queued.payload.subject, queued.payload.body);
      if (queued.channel === "whatsapp") await sendWhatsAppFn(queued.payload.message);
      notificationOutbox = settleNotification(notificationOutbox, queued.id, { ok: true }, runNow);
      currentStatus.notification_sent_ids = [...currentStatus.notification_sent_ids, queued.id].slice(-500);
      deliveryByKey.set(queued.dedupe_key, { ok: true });
      logger.info("notification_succeeded", { channel: queued.channel, outbox_id: queued.id });
    } catch (error) {
      notificationOutbox = settleNotification(notificationOutbox, queued.id, { ok: false, error }, runNow);
      deliveryByKey.set(queued.dedupe_key, { ok: false, error });
      logger.error("notification_failed", error, { channel: queued.channel, outbox_id: queued.id });
    }
    await checkpointNotificationOutbox(notificationOutbox, currentStatus, runNow);
  }

  const emailDelivery = emailKey ? deliveryByKey.get(emailKey) : null;
  const whatsappDelivery = deliveryByKey.get(whatsappKey);
  const emailResult = sendingEmail
    ? (emailDelivery?.ok ? { status: "fulfilled" } : { status: "rejected", reason: emailDelivery?.error ?? new Error("Email aguardando nova tentativa") })
    : { status: "fulfilled" };
  const waResult = whatsappDelivery?.ok
    ? { status: "fulfilled" }
    : { status: "rejected", reason: whatsappDelivery?.error ?? new Error("WhatsApp aguardando nova tentativa") };
  const emailActuallySent = sendingEmail && emailResult.status === "fulfilled";
  const whatsappActuallySent = waResult.status === "fulfilled";
  const delivered = emailActuallySent || whatsappActuallySent;

  if (sendingEmail) {
    if (emailResult.status === "fulfilled") console.log(`Email enviado para ${NOTIFY_TO}.`);
    else console.warn(`Email não enviado: ${sanitizeErrorMessage(emailResult.reason?.message)}`);
  }
  if (waResult.status === "fulfilled") console.log("WhatsApp enviado.");
  else console.warn(`WhatsApp não enviado: ${sanitizeErrorMessage(waResult.reason?.message)}`);

  const priorIdsInMessage = priorPending.map(f => f.id);
  const newAcks = delivered ? priorIdsInMessage : [];
  const priorAcks = mergeAcks(localStatus?.acknowledged_failure_ids || [], ciStatus?.acknowledged_failure_ids || []);
  const finalAcks = mergeAcks(priorAcks, newAcks);

  let workingPending = priorPending.filter(f => !finalAcks.includes(f.id));

  // Adiciona novas falhas desta rodada (com mensagem sanitizada)
  const newFailures = [];
  const runNowStr = runNow.toISOString();
  if (sendingEmail && emailResult.status === "rejected") {
    newFailures.push({
      channel: "email",
      error: sanitizeErrorMessage(emailResult.reason?.message)
    });
  }
  if (waResult.status === "rejected") {
    newFailures.push({
      channel: "whatsapp",
      error: sanitizeErrorMessage(waResult.reason?.message)
    });
  }

  // Merge final das pendências e escrita
  const finalPending = mergePendingFailures(workingPending, newFailures, runNowStr);

  const status = buildDeliveryStatus({
    now: runNow,
    sendingEmail,
    email: sendingEmail
      ? { ok: emailResult.status === "fulfilled", error: sanitizeErrorMessage(emailResult.reason?.message) }
      : undefined,
    whatsapp: { ok: waResult.status === "fulfilled", error: sanitizeErrorMessage(waResult.reason?.message) },
    pendingFailures: finalPending,
    acknowledgedFailureIds: finalAcks,
    notificationOutbox,
    source: process.env.GITHUB_ACTIONS === "true" ? "ci" : "local"
  });
  status.monitoring = {
    scope: onlyMercadoLivre ? "mercadolivre" : "local-watchlists",
    partial: errors.length > 0 || monitorOutcomes.some(item => item.status !== 'success'),
    status: errors.length ? (monitorOutcomes.some(item=>item.status==='blocked')?'blocked':'failed')
      : monitorOutcomes.some(item=>item.status==='partial')?'partial'
        : monitorOutcomes.some(item=>item.status==='deferred')?'deferred':'success',
    outcomes: monitorOutcomes,
    warnings: monitorOutcomes.filter(item=>['partial','deferred'].includes(item.status))
      .map(item=>({source:item.source,status:item.status,reasons:(item.reasons??[]).map(sanitizeErrorMessage)})),
    errors: errors.map(sanitizeErrorMessage),
  };
  status.notification_sent_ids = currentStatus.notification_sent_ids;
  roundSummary.delivery = status.delivery;
  status.round_summary = roundSummary;
  status.notification_archive = currentStatus.notification_archive;

  await writeDeliveryStatus(status);
  if (fsApi === fs) {
    await appendMonitorHistory(path.join(workspaceRoot, "data", "status"), {
      run_id: logger.runId,
      completed_at: new Date().toISOString(),
      outcome: errors.length ? (monitorOutcomes.some(item => item.status === 'blocked') ? 'blocked' : 'failed')
        : monitorOutcomes.some(item => item.status === 'partial') ? 'partial'
          : monitorOutcomes.some(item => item.status === 'deferred') ? 'deferred' : 'success',
      partial: status.monitoring.partial,
      duration_ms: Date.now() - runStart,
      item_count: totalNew + totalPrice,
      quarantined_item_count: 0,
      metadata: { source: status.source, monitor_errors: errors.length, monitor_failures: errors, pending_notifications: notificationOutbox.length },
    });
  }
  logger.done({ errors: errors.length, notification_outbox: notificationOutbox.length, operational_status: status.monitoring.status,
    partial_monitors: monitorOutcomes.filter(item=>item.status==='partial').length,
    deferred_monitors: monitorOutcomes.filter(item=>item.status==='deferred').length });

  // Propagação de erro se algum monitor falhou
  if (errors.length > 0) {
    console.error(`Rodada concluída com ${errors.length} erro(s) de monitoramento.`);
    process.exitCode = 1;
  }
} finally {
  sourceSummaries = previousSummaries; reportReadErrors = previousReadErrors;
  fsApi = prevFsApi;
  runCommandFn = prevRunCommandFn;
  if (priorTrafficRun === undefined) delete process.env.OLX_TRAFFIC_RUN_ID;
  else process.env.OLX_TRAFFIC_RUN_ID = priorTrafficRun;
}
}

async function readStatusFile(filePath) {
  try { return JSON.parse(await fsApi.readFile(filePath, "utf8")); }
  catch { return null; }
}

async function writeDeliveryStatus(status) {
  try {
    const filePath = getStatusFilePath();
    if (fsApi === fs) {
      await writeJsonAtomic(filePath, status, { validate: null });
    } else {
      await fsApi.mkdir(path.dirname(filePath), { recursive: true });
      await fsApi.writeFile(filePath, JSON.stringify(status, null, 2), "utf8");
    }
  } catch (err) {
    console.warn(`Não consegui gravar status de entrega: ${sanitizeErrorMessage(err?.message ?? err)}`);
  }
}

// O checkpoint e gravado antes e depois de cada chamada externa. Se o processo
// morrer no meio, o item fica em "sending" e a proxima rodada o recupera.
async function checkpointNotificationOutbox(notificationOutbox, currentStatus, now) {
  await writeDeliveryStatus({
    ...currentStatus,
    generated_at: now.toISOString(),
    source: process.env.GITHUB_ACTIONS === "true" ? "ci" : "local",
    notification_outbox: notificationOutbox,
  });
}

// ── concorrência ─────────────────────────────────────────────────────────────

/**
 * Roda `jobs` (tuplas [name, factory, isBrowserJob]) preservando a semântica de
 * Promise.allSettled (array de {status, reason?} na ordem original), mas limita
 * quantos jobs marcados `isBrowserJob` (cada um abre seu próprio Chromium) rodam
 * ao mesmo tempo. Jobs não marcados (Enjoei via API, sem Chrome) disparam de
 * imediato, sem entrar na fila.
 */
async function runJobsWithBrowserLimit(jobs, limit) {
  const results = new Array(jobs.length);
  const settle = async (index, factory) => {
    try {
      const value = await factory();
      results[index] = { status: "fulfilled", value };
    } catch (reason) {
      results[index] = { status: "rejected", reason };
    }
  };

  const immediate = [];
  const browserQueue = [];
  jobs.forEach(([, factory, isBrowserJob], index) => {
    if (isBrowserJob) browserQueue.push(index);
    else immediate.push(settle(index, factory));
  });

  let nextQueueIndex = 0;
  const worker = async () => {
    while (nextQueueIndex < browserQueue.length) {
      const index = browserQueue[nextQueueIndex];
      nextQueueIndex += 1;
      await settle(index, jobs[index][1]);
    }
  };
  const workers = Array.from({ length: Math.min(limit, browserQueue.length) }, worker);

  await Promise.all([...immediate, ...workers]);
  return results;
}

// ── scripts ───────────────────────────────────────────────────────────────────

function runScript(scriptName, extraArgs) {
  const scriptPath = path.join(workspaceRoot, "scripts", scriptName);
  return runCommandFn(process.execPath, [scriptPath, ...extraArgs]);
}

function runOlxMonitor(olxMaxPerCpu) {
  if (process.platform === "win32" && process.env.GITHUB_ACTIONS !== "true") {
    return runCommandFn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(workspaceRoot, "scripts", "run-olx-monitor.ps1"),
      "-MaxPerCpu",
      olxMaxPerCpu,
    ]);
  }
  return runScript("monitor-olx-notebooks-por-cpu.mjs", ["--headless", "--max-per-cpu", olxMaxPerCpu]);
}

function runCommand(command, args) {
  return runMonitorProcess(command, args, { cwd: workspaceRoot, env: automationChildEnvironment(workspaceRoot) });
}

function getArgValue(name, args = process.argv) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

async function readLatestReport(dir, minTime = null) {
  try {
  if (fsApi === fs) {
    const committed = await readLatestCommittedReport(dir);
    if (committed) {
      const timestamp = Date.parse(committed.manifest.committed_at ?? "");
      if (minTime != null && Number.isFinite(timestamp) && timestamp < minTime) return null;
      sourceSummaries.set(dir, committed.manifest.summary ?? buildCollectionSummary(committed.snapshot));
      return await applyNotebookRamPreference(dir, committed.report);
    }
  }
  const entries = await fsApi.readdir(dir).catch(() => []);
  const reports = entries
    .filter((n) => n.startsWith("report-") && !n.startsWith("report-premium-") && n.endsWith(".md"))
    .sort().reverse();
  if (!reports.length) return null;
  // Se o relatório mais recente é de antes desta rodada, a fonte não produziu
  // nada agora (falhou) — não o apresentamos como resultado atual.
  if (minTime != null) {
    const ts = reportFileTime(reports[0]);
    if (ts != null && ts < minTime) return null;
  }
  return await applyNotebookRamPreference(dir, await fsApi.readFile(path.join(dir, reports[0]), "utf8"));
  } catch (error) {
    reportReadErrors.set(dir, `falha ao ler resultados: ${sanitizeErrorMessage(error.message)}`);
    return null;
  }
}

async function applyNotebookRamPreference(dir, report) {
  if([OLED_MONITORES_DIR,localDir('mercadolivre-oled-monitores')].includes(dir)) {
    const {snapshot}=await readLatestValidSnapshot(dir);
    return filterOledReport(report,new Map([...(snapshot?.items??[]),...(snapshot?.pending_items??[])].map(item=>[item.url,item])));
  }
  if (dir === ENJOEI_DIR) {
    const { snapshot } = await readLatestValidSnapshot(dir);
    const details = new Map([...(snapshot?.items ?? []), ...(snapshot?.pending_items ?? [])].map(item => [item.url, item]));
    return filterBarefootReport(report, details);
  }
  if (![OLX_DIR, ENJOEI_NOTEBOOKS_DIR, localDir("mercadolivre-notebooks")].includes(dir)) return report;
  const { snapshot } = await readLatestValidSnapshot(dir);
  const details = new Map((snapshot?.items ?? []).map(item => [item.url, item]));
  return filterNotebookReportRam(report, details);
}

// Instante (epoch ms) embutido no nome do arquivo de relatório, ou null.
function reportFileTime(file) {
  const m = file.match(/report-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.md$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  const t = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}Z`);
  return Number.isNaN(t) ? null : t;
}

async function readLatestPremiumReport(dir) {
  const entries = await fsApi.readdir(dir).catch(() => []);
  const reports = entries
    .filter((n) => n.startsWith("report-premium-") && n.endsWith(".md"))
    .sort().reverse();
  if (!reports.length) return null;
  return fsApi.readFile(path.join(dir, reports[0]), "utf8");
}

// Aceita acento/sem acento: "Alterações de preço detectadas: **4**" e "Alteracoes de preco: **0**".
const PRICE_CHANGE_RE = /Altera[cç][oõ]es de pre[cç]o[^:]*:\s*\*\*(\d+)\*\*/;

function extractNewCount(report, regex) {
  if (!report) return 0;
  const m = report.match(regex);
  return m ? Number(m[1]) : 0;
}

// ── mensagens ─────────────────────────────────────────────────────────────────

function buildSubject(sources, errors) {
  const totalNew   = sources.reduce((sum, s) => sum + s.newCount, 0);
  const totalPrice = sources.reduce((sum, s) => sum + s.priceCount, 0);
  const parts = [];
  if (totalNew > 0)   parts.push(`${totalNew} novo(s)`);
  if (totalPrice > 0) parts.push(`${totalPrice} alteração(ões) de preço`);
  if (errors.length)  parts.push("erros");
  if (!parts.length)  parts.push("sem novidades");
  return `[Monitor] ${parts.join(" | ")} — ${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`;
}

function buildBody(sources, errors) {
  const sections = [];
  if (errors.length) sections.push("## Erros nesta rodada\n" + errors.map((e) => `- ${e}`).join("\n"));
  for (const s of sources) {
    if ((s.newCount > 0 || s.priceCount > 0) && s.report) sections.push(s.report);
  }
  return sections.join("\n\n---\n\n");
}

function buildWhatsAppMessage(sources, errors, roundSummary) {
  // Fixa o fuso em BRT: o monitor Enjoei roda no GitHub Actions (UTC), entao
  // sem timeZone o horario saia 3h adiantado (ex.: 16:01 BRT aparecia "19:01").
  const date = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
  const time = new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  const lines = [`Monitor ${date} ${time}`];
  let coverageLines = [];
  if (roundSummary?.sources.length) {
    const partial = roundSummary.sources.filter(source => source.summary?.coverage?.status !== 'complete' || source.summary?.execution !== 'success');
    lines.push(`${roundSummary.sources.length} fontes com resultados; ${partial.length} com limitações ou pendências.`);
    coverageLines = roundSummary.sources.filter(source => source.id === 'olx' || partial.includes(source)).map(collectionSummaryLine);
  }

  if (errors.length) lines.push(`Erros: ${errors.map((error) => {
    const label = String(error).split(':')[0].slice(0, 70);
    const kind = classifyMonitorError(error).kind;
    const message = { challenge: 'verificação ou bloqueio de acesso', authentication: 'login necessário', rate_limited: 'limite de acessos', transient: 'falha temporária de rede/navegação' }[kind] ?? 'coleta incompleta';
    return `${label}: ${message}`;
  }).join('; ')}`);

  const totalNew   = sources.reduce((sum, s) => sum + s.newCount, 0);
  const totalPrice = sources.reduce((sum, s) => sum + s.priceCount, 0);

  if (totalNew === 0 && totalPrice === 0) {
    lines.push(...coverageLines);
    lines.push(errors.length
      ? "Coleta incompleta; nenhum novo item ou alteração de preço confirmado nesta rodada."
      : "Nenhum novo item ou alteração de preço confirmado na cobertura desta rodada.");
    lines.push('Detalhes completos: https://almeida3339.github.io/olx-daily/');
    return capByWholeLines(lines, 1500);
  }

  for (const s of sources) {
    if (s.newCount === 0 && s.priceCount === 0) continue;
    const tags = [];
    if (s.newCount > 0)   tags.push(`${s.newCount} novo(s)`);
    if (s.priceCount > 0) tags.push(`${s.priceCount} preço(s)`);
    lines.push(`\n${s.label}: ${tags.join(", ")}`);
    const itemLines = items => items.slice(0, 2).map(item => `${item.title} — R$ ${Number(item.price_brl).toLocaleString('pt-BR')} — ${item.url}`);
    if (s.newCount > 0) lines.push(...(s.summary?.findings?.new_items ? itemLines(s.summary.findings.new_items) : extractNewItems(s.report, s.newSec).slice(0, 2)));
    if (s.priceCount > 0) lines.push(...(s.summary?.findings?.price_changes ? itemLines(s.summary.findings.price_changes) : extractNewItems(s.report, s.priceSec).slice(0, 2)));
  }

  lines.push(...coverageLines);
  lines.push(emailNotificationsDisabled()
    ? "\nDetalhes completos: https://almeida3339.github.io/olx-daily/"
    : "\nDetalhes completos por email.");
  return capByWholeLines(lines, 1500);
}

function mercadoLivreReportErrors(label, report) {
  if (!report) return [];
  const failedCount = extractNewCount(report, /Termos com falha:\s*\*\*(\d+)\*\*/);
  const failures = report.match(/## Falhas parciais\r?\n([\s\S]*?)(?:\r?\n## |$)/)?.[1]
    .split(/\r?\n/).filter((line) => line.startsWith("- ")) ?? [];
  if (failedCount > 0 || failures.length) {
    return failures.length
      ? failures.map((line) => `${label}: ${sanitizeErrorMessage(line.slice(2))}`)
      : [`${label}: ${failedCount} termo(s) com falha; coleta incompleta.`];
  }
  if (/Fila interrompida:\s*\*\*sim\*\*/i.test(report)) {
    return [`${label}: fila interrompida; coleta incompleta.`];
  }
  return [];
}

// Limita o tamanho da mensagem sem cortar uma linha (e sua URL) no meio: vai
// somando linhas inteiras até o orçamento e descarta o excedente como um todo.
function capByWholeLines(lines, max) {
  const out = [];
  let used = 0;
  const footer = /Detalhes completos/.test(lines.at(-1) ?? '') ? lines.at(-1) : null;
  const budget = footer ? max - footer.length - 1 : max;
  for (const line of footer ? lines.slice(0, -1) : lines) {
    const add = (out.length ? 1 : 0) + line.length; // +1 do "\n"
    if (used + add > budget) break;
    out.push(line);
    used += add;
  }
  if (footer) out.push(footer);
  return out.join("\n");
}

function extractNewItems(report, sectionHeader) {
  if (!report) return [];
  const start = report.indexOf(sectionHeader);
  if (start === -1) return [];
  const end = report.indexOf("\n##", start + 1);
  const section = end === -1 ? report.slice(start) : report.slice(start, end);
  return section.split("\n")
    .filter((l) => l.startsWith("- ") && !l.includes("Nenhum"))
    .map(shortenKeepingUrl);
}

// Encurta a linha sem mutilar o link: trunca só o trecho ANTES da URL (preço +
// título) e mantém a URL inteira, que é a parte clicável do alerta de WhatsApp.
function shortenKeepingUrl(line, maxPrefix = 150) {
  const idx = line.search(/https?:\/\//);
  if (idx === -1) return line.length > maxPrefix ? line.slice(0, maxPrefix - 1) + "…" : line;
  const prefix = line.slice(0, idx);
  const url = line.slice(idx).trim();
  const head = prefix.length > maxPrefix ? prefix.slice(0, maxPrefix - 1) + "… " : prefix;
  return head + url;
}

// ── email / WhatsApp ──────────────────────────────────────────────────────────

async function sendEmail(subject, body) {
  if (!GMAIL_USER) throw new Error("GMAIL_USER não definida");
  if (!GMAIL_APP_PASSWORD) throw new Error("GMAIL_APP_PASSWORD não definida");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 587, secure: false,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
  await transporter.sendMail({ from: `Monitor <${GMAIL_USER}>`, to: NOTIFY_TO, subject, text: body });
}
