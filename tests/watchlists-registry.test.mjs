import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  ALL_WATCHLISTS,
  LOCAL_WATCHLISTS,
  MERCADOLIVRE_WATCHLISTS,
  mercadoLivreDashboardCards,
  resolveAutomationDataDir,
  automationChildEnvironment,
  watchlistHealthDefinitions,
} from "../scripts/lib/watchlists-registry.mjs";

test("registry de watchlists mantém IDs e diretórios únicos", () => {
  const ids = ALL_WATCHLISTS.map((watchlist) => watchlist.id);
  const folders = ALL_WATCHLISTS.map((watchlist) => watchlist.repoFolder);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(folders).size, folders.length);
  assert.ok(LOCAL_WATCHLISTS.length >= 14);
  assert.ok(MERCADOLIVRE_WATCHLISTS.some((watchlist) => watchlist.id === "mercadolivre-google-pixel-watch-5"));
});

test("registry fornece cards do dashboard e prazos de saúde para as mesmas fontes", () => {
  const cards = mercadoLivreDashboardCards();
  const health = watchlistHealthDefinitions();
  assert.ok(cards.some(([chip, , subtitle, folder]) => chip === "Google Pixel Watch 5" && subtitle.includes("R$ 2.400") && folder === "mercadolivre-google-pixel-watch-5"));
  assert.ok(health.some(([id, label, maxAge]) => id === "google-pixel-watch-5" && label === "Google Pixel Watch 5" && maxAge === 24 * 60 * 60 * 1000));
});

test("orquestrador usa data/ do checkout no GitHub Actions sem env duplicada", () => {
  const previous = process.env.GITHUB_ACTIONS;
  const previousDataDir = process.env.GOOGLE_PIXEL_WATCH5_DATA_DIR;
  process.env.GITHUB_ACTIONS = "true";
  delete process.env.GOOGLE_PIXEL_WATCH5_DATA_DIR;
  try {
    assert.match(resolveAutomationDataDir("/workspace/repo", "google-pixel-watch-5"), /workspace[\\/]repo[\\/]data[\\/]google-pixel-watch-5$/);
  } finally {
    if (previous === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = previous;
    if (previousDataDir === undefined) delete process.env.GOOGLE_PIXEL_WATCH5_DATA_DIR;
    else process.env.GOOGLE_PIXEL_WATCH5_DATA_DIR = previousDataDir;
  }
});

test("coletores filhos recebem os mesmos diretorios publicados pelo CI e respeitam override", () => {
  const root = path.resolve("fixture/repo");
  const env = { GITHUB_ACTIONS: "true", HOME: "/home/runner", PATH: "fixture-path" };
  const childEnv = automationChildEnvironment(root, env);
  for (const watchlist of LOCAL_WATCHLISTS) {
    assert.equal(childEnv[watchlist.env], path.join(root, "data", watchlist.repoFolder));
  }
  assert.equal(childEnv.PATH, env.PATH);
  assert.equal(env.ENJOEI_DATA_DIR, undefined, "nao altera o ambiente do processo pai");
  assert.equal(automationChildEnvironment(root, { ...env, ENJOEI_DATA_DIR: "custom-data" }).ENJOEI_DATA_DIR, "custom-data");
});
