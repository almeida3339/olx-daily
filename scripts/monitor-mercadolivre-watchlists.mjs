import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMercadoLivreBatch } from "./lib/mercadolivre-production.mjs";
import {
  matchesMercadoLivreWatchlist,
  mercadoLivreWatchlistTermMatcher,
  mercadoLivreWatchlists,
} from "./lib/mercadolivre-watchlists.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profileDir = process.env.MERCADOLIVRE_PROFILE_DIR ?? path.join(root, ".chrome-mercadolivre-profile");
const selected = option("--watchlist");
const selectedTerm = option("--term");
const watchlists = selected
  ? mercadoLivreWatchlists.filter((watchlist) => watchlist.id === selected)
  : mercadoLivreWatchlists;

if (selected && watchlists.length === 0) throw new Error(`Busca desconhecida: ${selected}`);

console.log(`Fila Mercado Livre: ${watchlists.map((item) => item.label).join(", ")}`);
for (const watchlist of watchlists) {
  const terms = selectedTerm
    ? watchlist.terms.filter((term) => term.toLowerCase() === selectedTerm.toLowerCase())
    : watchlist.terms;
  if (selectedTerm && terms.length === 0) throw new Error(`Termo desconhecido para ${watchlist.id}: ${selectedTerm}`);
  await runMercadoLivreBatch({
    id: watchlist.id,
    label: watchlist.label,
    dataDir: path.join(root, "data", `mercadolivre-${watchlist.id}`),
    profileDir,
    terms,
    allTerms: watchlist.terms,
    minPrice: watchlist.minPrice,
    maxPrice: watchlist.maxPrice,
    searchOptions: watchlist.searchOptions ?? { localShipping: true },
    excludeTerms: watchlist.excludeTerms ?? [],
    itemFilter: (item) => matchesMercadoLivreWatchlist(item, watchlist),
    termMatcher: mercadoLivreWatchlistTermMatcher(watchlist) ?? undefined,
    relevantDetails: watchlist.relevantDetails,
  });
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
