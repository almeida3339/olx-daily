import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMercadoLivreBatch } from "./lib/mercadolivre-production.mjs";
import { normalizeOledSearchTerm } from './lib/oled-monitor-scope.mjs';
import {
  matchesMercadoLivreWatchlist,
  mercadoLivreWatchlistTermMatcher,
  mercadoLivreWatchlists,
} from "./lib/mercadolivre-watchlists.mjs";
import {
  clearMercadoLivreCooldown,
  planMercadoLivreTerms,
  readMercadoLivreSchedule,
  recordMercadoLivreRun,
  writeMercadoLivreSchedule,
} from "./lib/mercadolivre-scheduler.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profileDir = process.env.MERCADOLIVRE_PROFILE_DIR ?? path.join(root, ".chrome-mercadolivre-profile");
const selected = option("--watchlist");
const selectedTerm = option("--term");
const selectedTerms=selectedTerm?[...new Set(selectedTerm.split(',').map(term=>normalizeOledSearchTerm(term.trim())).filter(Boolean))]:null;
const includePaused = process.argv.includes("--include-paused");
const fullSweep = process.argv.includes("--full-sweep");
const completeCoverage = process.argv.includes('--complete-coverage');
const force = process.argv.includes("--force") || fullSweep;
// Orçamento padrão cobre todos os termos configurados hoje (30, ver soma de
// watchlist.terms.length abaixo) com folga — evita que uma watchlist grande
// (ex.: oled-monitores, 17 termos) esgote o orçamento e mate de fome as que
// vêm depois dela no array (foi o caso do tenis-42, nunca alcançado).
const DEFAULT_BUDGET = mercadoLivreWatchlists.reduce((sum, w) => sum + w.terms.length, 0) + 10;
const requestedBudget = Number(option("--max-terms") ?? process.env.ML_WATCHLIST_TERM_BUDGET ?? DEFAULT_BUDGET);
const budget = Number.isFinite(requestedBudget) && requestedBudget > 0 ? Math.floor(requestedBudget) : DEFAULT_BUDGET;
const selectedWatchlist = selected ? mercadoLivreWatchlists.find((watchlist) => watchlist.id === selected) : null;
const allSelected = selected ? (selectedWatchlist ? [selectedWatchlist] : []) : mercadoLivreWatchlists;
if (selected && allSelected.length === 0) throw new Error(`Busca desconhecida: ${selected}`);
if (!includePaused && selectedWatchlist?.paused) {
  console.log(`${selectedWatchlist.label}: busca pausada; nenhum termo consultado. Use --include-paused para uma execucao manual.`);
  process.exit(0);
}
const watchlists = allSelected.filter((watchlist) => includePaused || !watchlist.paused);

console.log(`Fila Mercado Livre: ${watchlists.map((item) => item.label).join(", ")}`);
let schedule = await readMercadoLivreSchedule(root);
if (process.argv.includes("--clear-cooldown")) {
  schedule = clearMercadoLivreCooldown(schedule);
  await writeMercadoLivreSchedule(root, schedule);
  console.log("Pausa de seguranca do Mercado Livre removida.");
}
let remaining = selectedTerm ? Number.POSITIVE_INFINITY : Math.max(1, budget);
watchlistQueue: for (const watchlist of watchlists) {
  const configuredTerms = selectedTerm
    ? watchlist.terms.filter((term) => selectedTerms.includes(watchlist.kind==='oled'?normalizeOledSearchTerm(term):term.toLowerCase()))
    : watchlist.terms;
  if (selectedTerm && configuredTerms.length !== selectedTerms.length) throw new Error(`Termo desconhecido para ${watchlist.id}: ${selectedTerm}`);
  const attempted = new Set();
  for (let batch = 0; batch < configuredTerms.length; batch++) {
  const plan = planMercadoLivreTerms(schedule, {
    watchlistId: watchlist.id,
    terms: configuredTerms.filter(term => !attempted.has(term)),
    maxTerms: fullSweep ? configuredTerms.length : Math.min(remaining, configuredTerms.length, watchlist.kind==='oled'?6:Infinity),
    force: force || Boolean(selectedTerm) || completeCoverage,
  });
  if (!plan.terms.length) {
    console.log(`${watchlist.label}: pulada (${plan.reason}${plan.next_at ? ` ate ${plan.next_at}` : ""}).`);
    if (["cooldown", "login_required"].includes(plan.reason)) {
      await writeMercadoLivreSchedule(root, schedule);
      process.exitCode = 1;
      console.error("Fila Mercado Livre bloqueada; resolva a verificacao ou login no perfil exclusivo.");
      break watchlistQueue;
    }
    break;
  }
  console.log(`${watchlist.label}: ${plan.terms.length}/${configuredTerms.length} termo(s) nesta rodada.`);
  const result = await runMercadoLivreBatch({
    id: watchlist.id,
    label: watchlist.label,
    dataDir: path.join(root, "data", `mercadolivre-${watchlist.id}`),
    profileDir,
    terms: plan.terms,
    allTerms: watchlist.terms,
    minPrice: watchlist.minPrice,
    maxPrice: watchlist.maxPrice,
    searchOptions: watchlist.searchOptions ?? { localShipping: true },
    excludeTerms: watchlist.excludeTerms ?? [],
    itemFilter: (item) => matchesMercadoLivreWatchlist(item, watchlist),
    termMatcher: mercadoLivreWatchlistTermMatcher(watchlist) ?? undefined,
    relevantDetails: watchlist.relevantDetails,
    kind: watchlist.kind ?? 'product',
  });
  schedule = recordMercadoLivreRun(schedule, {
    watchlistId: watchlist.id,
    scheduledTerms: plan.terms,
    configuredTerms: watchlist.terms,
    snapshot: result.snapshot,
  });
  await writeMercadoLivreSchedule(root, schedule);
  for (const term of plan.terms) attempted.add(term);
  if (result.snapshot.run?.aborted || result.snapshot.run?.failed_terms?.length) {
    console.error(`${watchlist.label}: coleta incompleta; resultados parciais preservados.`);
    process.exitCode = 1;
  }
  if (result.snapshot.run?.aborted || schedule.global.requires_login || Date.parse(schedule.global.blocked_until ?? "") > Date.now()) break watchlistQueue;
  remaining -= plan.terms.length;
  if (remaining <= 0 && !selectedTerm && !fullSweep) {
    console.log("Orcamento de termos desta rodada atingido; as demais buscas ficam para a proxima execucao.");
    break watchlistQueue;
  }
  // Recuperação explícita avança em lotes de até seis termos OLED. Cada termo
  // é tentado uma única vez; os limites de fichas e as pausas permanecem ativos.
  if (!completeCoverage || selectedTerm || fullSweep) break;
  }
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
