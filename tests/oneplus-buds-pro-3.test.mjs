import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMonitorCode } from "../scripts/lib/monitor-core.mjs";
import {
  ONEPLUS_BUDS_PRO3_EXCLUDE_TERMS,
  ONEPLUS_BUDS_PRO3_MATCH_VARIANTS,
  ONEPLUS_BUDS_PRO3_TERMS,
  hasOnePlusBrand,
} from "../scripts/lib/oneplus-buds-pro-3.mjs";
import {
  matchesMercadoLivreWatchlist,
  mercadoLivreWatchlistTermMatcher,
  mercadoLivreWatchlists,
} from "../scripts/lib/mercadolivre-watchlists.mjs";

// Reproduz o funil do watchlist-monitor (OLX/Enjoei): casar algum termo por
// substring normalizada + não bater exclusão + passar no itemFilter.
function aceitoNoOlxEnjoei(titulo) {
  const casaTermo = ONEPLUS_BUDS_PRO3_TERMS.some((termo) =>
    normalizeMonitorCode(titulo).includes(normalizeMonitorCode(termo)));
  const excluido = ONEPLUS_BUDS_PRO3_EXCLUDE_TERMS.some((termo) =>
    titulo.toLowerCase().includes(termo));
  return casaTermo && !excluido && hasOnePlusBrand(titulo);
}

const watchlistML = mercadoLivreWatchlists.find((w) => w.id === "oneplus-buds-pro-3");

// Reproduz o funil do Mercado Livre: matchVariants + matchesMercadoLivreWatchlist
// (que aplica excludeTerms e requiredAnyTerms).
function aceitoNoMercadoLivre(titulo) {
  const casaVariante = mercadoLivreWatchlistTermMatcher(watchlistML)(titulo);
  return casaVariante && matchesMercadoLivreWatchlist({ title: titulo }, watchlistML);
}

const DEVE_ACEITAR = [
  "OnePlus Buds Pro 3",
  "Fone de ouvido OnePlus Buds Pro 3 Bluetooth",
  "One Plus Buds Pro 3 lacrado na caixa",
  "OnePlus Buds Pro3 preto",
  "Fone Bluetooth Buds Pro 3 OnePlus original",
  "OnePlus Buds 3 Pro (vendedor inverteu a ordem)",
];

// O vizinho perigoso e o Nord Buds 3 Pro: o nome dele contem "buds 3 pro",
// quase igual ao "buds pro 3" do modelo alvo, so com os tokens invertidos.
const DEVE_REJEITAR = [
  "OnePlus Nord Buds 3 Pro",
  "OnePlus Nord Buds 2r",
  "OnePlus Buds 3",
  "Samsung Galaxy Buds3 Pro",
  "Galaxy Buds 3 Pro novo",
  "Redmi Buds 3 Pro",
  "OnePlus Buds Pro 2",
  "OnePlus Buds Pro primeira geracao",
];

test("OnePlus Buds Pro 3: OLX/Enjoei aceitam o modelo alvo", () => {
  for (const titulo of DEVE_ACEITAR) {
    assert.equal(aceitoNoOlxEnjoei(titulo), true, `deveria aceitar: ${titulo}`);
  }
});

test("OnePlus Buds Pro 3: OLX/Enjoei rejeitam Nord, nao-pro, geracoes antigas e outras marcas", () => {
  for (const titulo of DEVE_REJEITAR) {
    assert.equal(aceitoNoOlxEnjoei(titulo), false, `deveria rejeitar: ${titulo}`);
  }
});

test("OnePlus Buds Pro 3: Mercado Livre filtra igual ao OLX/Enjoei", () => {
  for (const titulo of DEVE_ACEITAR) {
    assert.equal(aceitoNoMercadoLivre(titulo), true, `ML deveria aceitar: ${titulo}`);
  }
  for (const titulo of DEVE_REJEITAR) {
    assert.equal(aceitoNoMercadoLivre(titulo), false, `ML deveria rejeitar: ${titulo}`);
  }
});

test("OnePlus Buds Pro 3: watchlist do ML usa a faixa pedida de R$ 300 a R$ 800", () => {
  assert.equal(watchlistML.minPrice, 300);
  assert.equal(watchlistML.maxPrice, 800);
});

test("OnePlus Buds Pro 3: a marca sozinha nao basta e o modelo sozinho tambem nao", () => {
  // Marca presente, modelo ausente.
  assert.equal(aceitoNoOlxEnjoei("OnePlus Nord CE 3 celular"), false);
  // Modelo presente, marca ausente (poderia ser Samsung/Xiaomi).
  assert.equal(aceitoNoOlxEnjoei("Fone Buds Pro 3 sem marca"), false);
  assert.equal(hasOnePlusBrand("One Plus"), true);
  assert.equal(ONEPLUS_BUDS_PRO3_MATCH_VARIANTS.includes("buds pro 3"), true);
});
