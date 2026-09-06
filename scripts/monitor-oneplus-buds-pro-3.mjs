// Watchlist do fone OnePlus Buds Pro 3 — OLX + Enjoei, R$ 300–800.
// As regras de identificação (termos, exclusão da linha Nord, exigência da
// marca) ficam em lib/oneplus-buds-pro-3.mjs, compartilhadas com a watchlist do
// Mercado Livre para as duas plataformas não divergirem.
import path from "node:path";
import { runWatchlistMonitor } from "./lib/watchlist-monitor.mjs";
import {
  ONEPLUS_BUDS_PRO3_EXCLUDE_TERMS,
  ONEPLUS_BUDS_PRO3_PRICE,
  ONEPLUS_BUDS_PRO3_TERMS,
  hasOnePlusBrand,
} from "./lib/oneplus-buds-pro-3.mjs";

const dataDir =
  process.env.ONEPLUS_BUDS_PRO3_DATA_DIR ??
  path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".codex", "automations", "monitor-oneplus-buds-pro-3");

runWatchlistMonitor({
  label: "OnePlus Buds Pro 3",
  dataDir,
  profileDir: ".chrome-oneplus-buds-pro-3-profile",
  terms: ONEPLUS_BUDS_PRO3_TERMS,
  minPrice: ONEPLUS_BUDS_PRO3_PRICE.min,
  maxPrice: ONEPLUS_BUDS_PRO3_PRICE.max,
  excludeTerms: ONEPLUS_BUDS_PRO3_EXCLUDE_TERMS,
  // No Enjoei o itemFilter recebe titulo + marca, então anúncios que só
  // declaram a marca no campo estruturado também passam.
  itemFilter: ({ title }) => hasOnePlusBrand(title),
}).catch((error) => {
  console.error(`\nFalha: ${error.stack || error.message}`);
  process.exitCode = 1;
});
