import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMercadoLivreBatch } from "./lib/mercadolivre-production.mjs";
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
const fullSweep = process.argv.includes("--full-sweep");
const force = process.argv.includes("--force") || fullSweep;
// Orçamento padrão cobre todos os termos configurados hoje (30, ver soma de
// watchlist.terms.length abaixo) com folga — evita que uma watchlist grande
// (ex.: oled-monitores, 17 termos) esgote o orçamento e mate de fome as que
// vêm depois dela no array (foi o caso do tenis-42, nunca alcançado).
const DEFAULT_BUDGET = mercadoLivreWatchlists.reduce((sum, w) => sum + w.terms.length, 0) + 10;
const requestedBudget = Number(option("--max-terms") ?? process.env.ML_WATCHLIST_TERM_BUDGET ?? DEFAULT_BUDGET);
const budget = Number.isFinite(requestedBudget) && requestedBudget > 0 ? Math.floor(requestedBudget) : DEFAULT_BUDGET;
const watchlists = selected
  ? mercadoLivreWatchlists.filter((watchlist) => watchlist.id === selected)
  : mercadoLivreWatchlists;

if (selected && watchlists.length === 0) throw new Error(`Busca desconhecida: ${selected}`);

console.log(`Fila Mercado Livre: ${watchlists.map((item) => item.label).join(", ")}`);
let schedule = await readMercadoLivreSchedule(root);
if (process.argv.includes("--clear-cooldown")) {
  schedule = clearMercadoLivreCooldown(schedule);
  await writeMercadoLivreSchedule(root, schedule);
  console.log("Pausa de seguranca do Mercado Livre removida.");
}
let remaining = selectedTerm ? Number.POSITIVE_INFINITY : Math.max(1, budget);
for (const watchlist of watchlists) {
  const configuredTerms = selectedTerm
    ? watchlist.terms.filter((term) => term.toLowerCase() === selectedTerm.toLowerCase())
    : watchlist.terms;
  if (selectedTerm && configuredTerms.length === 0) throw new Error(`Termo desconhecido para ${watchlist.id}: ${selectedTerm}`);
  const plan = planMercadoLivreTerms(schedule, {
    watchlistId: watchlist.id,
    terms: configuredTerms,
    maxTerms: fullSweep ? configuredTerms.length : Math.min(remaining, configuredTerms.length),
    force: force || Boolean(selectedTerm),
  });
  if (!plan.terms.length) {
    console.log(`${watchlist.label}: pulada (${plan.reason}${plan.next_at ? ` ate ${plan.next_at}` : ""}).`);
    continue;
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
  });
  schedule = recordMercadoLivreRun(schedule, {
    watchlistId: watchlist.id,
    scheduledTerms: plan.terms,
    configuredTerms: watchlist.terms,
    snapshot: result.snapshot,
  });
  await writeMercadoLivreSchedule(root, schedule);
  remaining -= plan.terms.length;
  if (remaining <= 0 && !selectedTerm && !fullSweep) {
    console.log("Orcamento de termos desta rodada atingido; as demais buscas ficam para a proxima execucao.");
    break;
  }
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
