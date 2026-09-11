// Watchlist do Google Pixel Watch 4 — OLX + Enjoei.
// Somente 45 mm: Wi-Fi/Bluetooth até R$ 2.000; LTE até R$ 2.500.
import path from "node:path";
import { runWatchlistMonitor } from "./lib/watchlist-monitor.mjs";
import {
  GOOGLE_PIXEL_WATCH4_EXCLUDE_TERMS,
  GOOGLE_PIXEL_WATCH4_PRICE,
  GOOGLE_PIXEL_WATCH4_TERMS,
  matchesGooglePixelWatch4,
} from "./lib/google-pixel-watch-4.mjs";

const dataDir =
  process.env.GOOGLE_PIXEL_WATCH4_DATA_DIR ??
  path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".codex", "automations", "monitor-google-pixel-watch-4");

runWatchlistMonitor({
  label: "Google Pixel Watch 4",
  dataDir,
  profileDir: ".chrome-google-pixel-watch-4-profile",
  terms: GOOGLE_PIXEL_WATCH4_TERMS,
  minPrice: GOOGLE_PIXEL_WATCH4_PRICE.min,
  maxPrice: GOOGLE_PIXEL_WATCH4_PRICE.max,
  excludeTerms: GOOGLE_PIXEL_WATCH4_EXCLUDE_TERMS,
  itemFilter: matchesGooglePixelWatch4,
}).catch((error) => {
  console.error(`\nFalha: ${error.stack || error.message}`);
  process.exitCode = 1;
});
