import path from "node:path";

// Registro operacional único das fontes monitoradas. As regras de matching
// específicas continuam nas libs de cada produto; este módulo concentra os
// nomes, diretórios, variáveis de ambiente e metadados usados pelo painel,
// saúde e notificações.
export const LOCAL_WATCHLISTS = Object.freeze([
  { id: "olx", label: "OLX Notebooks", env: "OLX_DATA_DIR", repoFolder: "olx", fallback: "monitor-olx-notebooks-por-cpu", maxAgeHours: 24 },
  { id: "enjoei-notebooks", label: "Enjoei Notebooks", env: "ENJOEI_NOTEBOOKS_DATA_DIR", repoFolder: "enjoei-notebooks", fallback: "monitor-enjoei-notebooks", maxAgeHours: 24 },
  { id: "enjoei", label: "Enjoei Tênis 42", env: "ENJOEI_DATA_DIR", repoFolder: "enjoei", fallback: "monitor-enjoei-tenis-42", maxAgeHours: 24 },
  { id: "dockstations", label: "Dockstations", env: "DOCKSTATIONS_DATA_DIR", repoFolder: "dockstations", fallback: "monitor-dockstations", maxAgeHours: 24 },
  { id: "fitbit", label: "Fitbit Air", env: "FITBIT_DATA_DIR", repoFolder: "fitbit", fallback: "monitor-fitbit", maxAgeHours: 24 },
  { id: "lifefactory", label: "Lifefactory", env: "LIFEFACTORY_DATA_DIR", repoFolder: "lifefactory", fallback: "monitor-lifefactory", maxAgeHours: 24 },
  { id: "tela-galaxybook3", label: "Tela Book3", env: "TELA_GALAXYBOOK3_DATA_DIR", repoFolder: "tela-galaxybook3", fallback: "monitor-tela-galaxybook3", maxAgeHours: 24 },
  { id: "melanger", label: "Melanger", env: "MELANGER_DATA_DIR", repoFolder: "melanger", fallback: "monitor-melanger", maxAgeHours: 24 },
  { id: "galaxy-buds4-pro", label: "Galaxy Buds4 Pro", env: "GALAXY_BUDS4_PRO_DATA_DIR", repoFolder: "galaxy-buds4-pro", fallback: "monitor-galaxy-buds4-pro", maxAgeHours: 24 },
  { id: "oneplus-buds-pro-3", label: "OnePlus Buds Pro 3", env: "ONEPLUS_BUDS_PRO3_DATA_DIR", repoFolder: "oneplus-buds-pro-3", fallback: "monitor-oneplus-buds-pro-3", maxAgeHours: 24 },
  { id: "google-pixel-watch-4", label: "Google Pixel Watch 4", env: "GOOGLE_PIXEL_WATCH4_DATA_DIR", repoFolder: "google-pixel-watch-4", fallback: "monitor-google-pixel-watch-4", maxAgeHours: 24 },
  { id: "google-pixel-watch-5", label: "Google Pixel Watch 5", env: "GOOGLE_PIXEL_WATCH5_DATA_DIR", repoFolder: "google-pixel-watch-5", fallback: "monitor-google-pixel-watch-5", maxAgeHours: 24 },
  { id: "oura-ring5", label: "Oura Ring 5", env: "OURA_RING5_DATA_DIR", repoFolder: "oura-ring5", fallback: "monitor-oura-ring5", maxAgeHours: 24 },
  { id: "oled-monitores", label: "Monitores OLED", env: "OLED_MONITORES_DATA_DIR", repoFolder: "oled-monitores", fallback: "monitor-oled-monitores", maxAgeHours: 24 },
]);

export const MERCADOLIVRE_WATCHLISTS = Object.freeze([
  { id: "mercadolivre-notebooks", label: "Mercado Livre Notebooks", healthLabel: "ML Notebooks", env: "MERCADOLIVRE_NOTEBOOKS_DATA_DIR", repoFolder: "mercadolivre-notebooks", maxAgeHours: 7 * 24 },
  { id: "mercadolivre-galaxy-buds4-pro", label: "Mercado Livre Galaxy Buds4 Pro", healthLabel: "ML Galaxy Buds4 Pro", repoFolder: "mercadolivre-galaxy-buds4-pro", maxAgeHours: 7 * 24 },
  { id: "mercadolivre-oneplus-buds-pro-3", label: "Mercado Livre OnePlus Buds Pro 3", healthLabel: "ML OnePlus Buds Pro 3", repoFolder: "mercadolivre-oneplus-buds-pro-3", maxAgeHours: 7 * 24 },
  { id: "mercadolivre-google-pixel-watch-4", label: "Mercado Livre Google Pixel Watch 4", healthLabel: "ML Google Pixel Watch 4", repoFolder: "mercadolivre-google-pixel-watch-4", maxAgeHours: 7 * 24 },
  { id: "mercadolivre-google-pixel-watch-5", label: "Mercado Livre Google Pixel Watch 5", healthLabel: "ML Google Pixel Watch 5", repoFolder: "mercadolivre-google-pixel-watch-5", maxAgeHours: 7 * 24 },
  { id: "mercadolivre-dockstations", label: "Mercado Livre Dockstations", healthLabel: "ML Dockstations", repoFolder: "mercadolivre-dockstations", maxAgeHours: 7 * 24 },
  { id: "mercadolivre-fitbit-air", label: "Mercado Livre Fitbit Air", healthLabel: "ML Fitbit Air", repoFolder: "mercadolivre-fitbit-air", maxAgeHours: 7 * 24 },
  { id: "mercadolivre-lifefactory", label: "Mercado Livre Lifefactory", healthLabel: "ML Lifefactory", repoFolder: "mercadolivre-lifefactory", maxAgeHours: 7 * 24 },
  { id: "mercadolivre-tela-galaxybook3", label: "Mercado Livre Tela Galaxy Book3", healthLabel: "ML Tela Book3", repoFolder: "mercadolivre-tela-galaxybook3", maxAgeHours: 7 * 24 },
  { id: "mercadolivre-melanger", label: "Mercado Livre Melanger", healthLabel: "ML Melanger", repoFolder: "mercadolivre-melanger", maxAgeHours: 7 * 24 },
  { id: "mercadolivre-tenis-42", label: "Mercado Livre Tênis 42", healthLabel: "ML Tênis 42", repoFolder: "mercadolivre-tenis-42", maxAgeHours: 7 * 24 },
  { id: "mercadolivre-oled-monitores", label: "Mercado Livre Monitores OLED", healthLabel: "ML Monitores OLED", repoFolder: "mercadolivre-oled-monitores", maxAgeHours: 7 * 24 },
]);

export const ALL_WATCHLISTS = Object.freeze([...LOCAL_WATCHLISTS, ...MERCADOLIVRE_WATCHLISTS]);

export function getWatchlist(id) {
  return ALL_WATCHLISTS.find((watchlist) => watchlist.id === id) ?? null;
}

export function resolveWatchlistDataDir(root, watchlist) {
  const spec = typeof watchlist === "string" ? getWatchlist(watchlist) : watchlist;
  if (!spec) throw new Error(`Watchlist não registrada: ${watchlist}`);
  return process.env[spec.env] ?? path.join(root, "data", spec.repoFolder);
}

export function resolveAutomationDataDir(root, watchlist) {
  const spec = typeof watchlist === "string" ? getWatchlist(watchlist) : watchlist;
  if (!spec) throw new Error(`Watchlist não registrada: ${watchlist}`);
  if (process.env[spec.env]) return process.env[spec.env];
  if (process.env.GITHUB_ACTIONS === "true") return path.join(root, "data", spec.repoFolder);
  const userRoot = process.env.USERPROFILE ?? process.env.HOME ?? "";
  return path.join(userRoot, ".codex", "automations", spec.fallback);
}

export function watchlistHealthDefinitions() {
  return ALL_WATCHLISTS.map((spec) => [
    spec.id,
    spec.healthLabel ?? spec.label,
    spec.maxAgeHours * 60 * 60 * 1000,
  ]);
}

export function mercadoLivreDashboardCards() {
  const subtitles = {
    "mercadolivre-galaxy-buds4-pro": "R$ 500 - R$ 1.000",
    "mercadolivre-oneplus-buds-pro-3": "R$ 300 - R$ 800",
    "mercadolivre-google-pixel-watch-4": "45 mm · Wi‑Fi até R$ 2.000 · LTE até R$ 2.500",
    "mercadolivre-google-pixel-watch-5": "45 mm · Wi‑Fi até R$ 2.400 · LTE até R$ 3.000",
    "mercadolivre-dockstations": "até R$ 500",
    "mercadolivre-fitbit-air": "R$ 300 - R$ 600",
    "mercadolivre-lifefactory": "500 ml-1 L · R$ 25 - R$ 75",
    "mercadolivre-tela-galaxybook3": "BA96-08462A · até R$ 1.000",
    "mercadolivre-melanger": "110/127V · R$ 1.000 - R$ 5.000",
    "mercadolivre-tenis-42": "masculino · tamanho 42 · até R$ 500",
    "mercadolivre-oled-monitores": "R$ 1.500 – R$ 3.000",
  };
  return MERCADOLIVRE_WATCHLISTS.filter((spec) => spec.id !== "mercadolivre-notebooks").map((spec) => [
    spec.label.replace(/^Mercado Livre /, ""),
    spec.label,
    subtitles[spec.id] ?? "",
    spec.repoFolder,
  ]);
}
