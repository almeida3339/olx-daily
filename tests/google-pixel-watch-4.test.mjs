import test from "node:test";
import assert from "node:assert/strict";
import {
  GOOGLE_PIXEL_WATCH4_PRICE,
  isPixelWatchLte,
  isPixelWatch45mm,
  matchesGooglePixelWatch4,
} from "../scripts/lib/google-pixel-watch-4.mjs";
import {
  mercadoLivreWatchlists,
  matchesMercadoLivreWatchlist,
} from "../scripts/lib/mercadolivre-watchlists.mjs";

const mlWatchlist = mercadoLivreWatchlists.find((item) => item.id === "google-pixel-watch-4");

test("Pixel Watch 4 aceita somente a versão de 45 mm", () => {
  assert.equal(isPixelWatch45mm("Google Pixel Watch 4 45mm"), true);
  assert.equal(isPixelWatch45mm("Google Pixel Watch 4 45 mm LTE"), true);
  assert.equal(isPixelWatch45mm("Google Pixel Watch 4 41mm"), false);
  assert.equal(isPixelWatch45mm("Google Pixel Watch 4"), false);
});

test("Pixel Watch 4 aplica teto diferente para Wi-Fi e LTE", () => {
  assert.equal(isPixelWatchLte("Pixel Watch 4 45mm Wi-Fi Bluetooth"), false);
  assert.equal(isPixelWatchLte("Pixel Watch 4 45mm 4G LTE"), true);
  assert.equal(matchesGooglePixelWatch4({ title: "Google Pixel Watch 4 45mm Wi-Fi", price_brl: 2000 }), true);
  assert.equal(matchesGooglePixelWatch4({ title: "Google Pixel Watch 4 45mm Wi-Fi", price_brl: 2001 }), false);
  assert.equal(matchesGooglePixelWatch4({ title: "Google Pixel Watch 4 45mm LTE", price_brl: 2500 }), true);
  assert.equal(matchesGooglePixelWatch4({ title: "Google Pixel Watch 4 45mm LTE", price_brl: 2501 }), false);
  assert.equal(GOOGLE_PIXEL_WATCH4_PRICE.max, 2500);
});

test("Pixel Watch 4 rejeita acessórios e a geração/tamanho errados", () => {
  assert.equal(matchesGooglePixelWatch4({ title: "Capa Pixel Watch 4 45mm", price_brl: 50 }), false);
  assert.equal(matchesGooglePixelWatch4({ title: "Google Pixel Watch 3 45mm", price_brl: 1500 }), false);
  assert.equal(matchesGooglePixelWatch4({ title: "Google Pixel Watch 4 41mm LTE", price_brl: 2200 }), false);
});

test("watchlist do Mercado Livre do Pixel Watch 4 usa a mesma regra", () => {
  assert.ok(mlWatchlist);
  assert.equal(mlWatchlist.minPrice, 0);
  assert.equal(mlWatchlist.maxPrice, 2500);
  assert.equal(matchesMercadoLivreWatchlist({ title: "Google Pixel Watch 4 45mm LTE", price_brl: 2500 }, mlWatchlist), true);
  assert.equal(matchesMercadoLivreWatchlist({ title: "Google Pixel Watch 4 45mm Wi-Fi", price_brl: 2001 }, mlWatchlist), false);
});
