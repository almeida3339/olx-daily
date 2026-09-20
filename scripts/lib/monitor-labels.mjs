import { ALL_WATCHLISTS } from "./watchlists-registry.mjs";

export const MONITOR_LABELS = Object.freeze(
  Object.fromEntries(ALL_WATCHLISTS.map((watchlist) => [watchlist.id, watchlist.label])),
);
