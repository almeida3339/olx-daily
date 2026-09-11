// Watchlist do Google Pixel Watch 5 — OLX + Enjoei.
// Somente 45 mm: Wi-Fi/Bluetooth até R$ 2.400; LTE até R$ 3.000.
import path from "node:path";
import { runWatchlistMonitor } from "./lib/watchlist-monitor.mjs";
import {
  GOOGLE_PIXEL_WATCH5_EXCLUDE_TERMS,
  GOOGLE_PIXEL_WATCH5_PRICE,
  GOOGLE_PIXEL_WATCH5_TERMS,
  matchesGooglePixelWatch5,
} from "./lib/google-pixel-watch-5.mjs";

const dataDir =
  process.env.GOOGLE_PIXEL_WATCH5_DATA_DIR ??
  path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".codex", "automations", "monitor-google-pixel-watch-5");

runWatchlistMonitor({
  label: "Google Pixel Watch 5",
  dataDir,
  profileDir: ".chrome-google-pixel-watch-5-profile",
  terms: GOOGLE_PIXEL_WATCH5_TERMS,
  minPrice: GOOGLE_PIXEL_WATCH5_PRICE.min,
  maxPrice: GOOGLE_PIXEL_WATCH5_PRICE.max,
  excludeTerms: GOOGLE_PIXEL_WATCH5_EXCLUDE_TERMS,
  itemFilter: matchesGooglePixelWatch5,
}).catch((error) => {
  console.error(`\nFalha: ${error.stack || error.message}`);
  process.exitCode = 1;
});
