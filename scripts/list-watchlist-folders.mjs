import { ALL_WATCHLISTS, LOCAL_WATCHLISTS, MERCADOLIVRE_WATCHLISTS } from "./lib/watchlists-registry.mjs";

const mode = (process.argv[2] ?? "all").replace(/^--/, "");
const source = mode === "mercadolivre" ? MERCADOLIVRE_WATCHLISTS : mode === "local" ? LOCAL_WATCHLISTS : ALL_WATCHLISTS;
process.stdout.write(JSON.stringify([...new Set(source.map((watchlist) => watchlist.repoFolder))]));
