// Watchlist do Fitbit Air (OLX + Enjoei) na faixa R$ 300–R$ 600.
// A lógica de coleta/merge/relatório vive em lib/watchlist-monitor.mjs.
import path from "node:path";
import { runWatchlistMonitor } from "./lib/watchlist-monitor.mjs";

import { getWatchlist } from './lib/watchlists-registry.mjs';

if (getWatchlist('fitbit').paused && process.env.INCLUDE_PAUSED_WATCHLIST !== '1' && !process.argv.includes('--include-paused')) {
  console.log('Fitbit Air: busca pausada; nenhum termo consultado.');
  process.exit(0);
}

const dataDir =
  process.env.FITBIT_DATA_DIR ??
  path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".codex", "automations", "monitor-fitbit");

runWatchlistMonitor({
  label: "Fitbit Air",
  dataDir,
  profileDir: ".chrome-fitbit-profile",
  terms: ["fitbit air"],
  minPrice: 300,
  maxPrice: 600,
}).catch((error) => {
  console.error(`\nFalha: ${error.stack || error.message}`);
  process.exitCode = 1;
});
