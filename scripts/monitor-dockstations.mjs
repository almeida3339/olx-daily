// Watchlist de dockstations (OLX + Enjoei) até um teto de preço.
// A lógica de coleta/merge/relatório vive em lib/watchlist-monitor.mjs.
import path from "node:path";
import { runWatchlistMonitor } from "./lib/watchlist-monitor.mjs";
import { getWatchlist } from './lib/watchlists-registry.mjs';

if(getWatchlist('dockstations').paused && process.env.INCLUDE_PAUSED_WATCHLIST !== '1' && !process.argv.includes('--include-paused')) {
  console.log('Dockstations: busca pausada; nenhum termo consultado.');
  process.exit(0);
}

const dataDir =
  process.env.DOCKSTATIONS_DATA_DIR ??
  path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".codex", "automations", "monitor-dockstations");

runWatchlistMonitor({
  label: "Dockstations",
  dataDir,
  profileDir: ".chrome-dockstations-profile",
  terms: ["SD25TB4", "WD22TB4"],
  minPrice: 0,
  maxPrice: 500,
}).catch((error) => {
  console.error(`\nFalha: ${error.stack || error.message}`);
  process.exitCode = 1;
});
