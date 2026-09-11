import test from "node:test";
import assert from "node:assert/strict";
import {
  GOOGLE_PIXEL_WATCH5_PRICE,
  isPixelWatch5Lte,
  isPixelWatch5_45mm,
  matchesGooglePixelWatch5,
} from "../scripts/lib/google-pixel-watch-5.mjs";
import {
  mercadoLivreWatchlists,
  matchesMercadoLivreWatchlist,
} from "../scripts/lib/mercadolivre-watchlists.mjs";

const mlWatchlist = mercadoLivreWatchlists.find((item) => item.id === "google-pixel-watch-5");

test("Pixel Watch 5 aceita somente a versão de 45 mm", () => {
  assert.equal(isPixelWatch5_45mm("Google Pixel Watch 5 45mm"), true);
  assert.equal(isPixelWatch5_45mm("Google Pixel Watch 5 45 mm LTE"), true);
  assert.equal(isPixelWatch5_45mm("Google Pixel Watch 5 41mm"), false);
  assert.equal(isPixelWatch5_45mm("Google Pixel Watch 5"), false);
});

test("Pixel Watch 5 aplica teto diferente para Wi-Fi e LTE", () => {
  assert.equal(isPixelWatch5Lte("Pixel Watch 5 45mm Wi-Fi Bluetooth"), false);
  assert.equal(isPixelWatch5Lte("Pixel Watch 5 45mm 4G LTE + Wi-Fi"), true);
  assert.equal(matchesGooglePixelWatch5({ title: "Google Pixel Watch 5 45mm Wi-Fi", price_brl: 2400 }), true);
  assert.equal(matchesGooglePixelWatch5({ title: "Google Pixel Watch 5 45mm Wi-Fi", price_brl: 2401 }), false);
  assert.equal(matchesGooglePixelWatch5({ title: "Google Pixel Watch 5 45mm LTE", price_brl: 3000 }), true);
  assert.equal(matchesGooglePixelWatch5({ title: "Google Pixel Watch 5 45mm LTE", price_brl: 3001 }), false);
  assert.equal(GOOGLE_PIXEL_WATCH5_PRICE.max, 3000);
});

test("Pixel Watch 5 rejeita acessórios e gerações diferentes", () => {
  assert.equal(matchesGooglePixelWatch5({ title: "Capa Pixel Watch 5 45mm", price_brl: 50 }), false);
  assert.equal(matchesGooglePixelWatch5({ title: "Google Pixel Watch 4 45mm", price_brl: 1800 }), false);
  assert.equal(matchesGooglePixelWatch5({ title: "Google Pixel Watch 5 41mm LTE", price_brl: 2600 }), false);
});

test("watchlist do Mercado Livre do Pixel Watch 5 usa a mesma regra", () => {
  assert.ok(mlWatchlist);
  assert.equal(mlWatchlist.minPrice, 0);
  assert.equal(mlWatchlist.maxPrice, 3000);
  assert.equal(matchesMercadoLivreWatchlist({ title: "Google Pixel Watch 5 45mm LTE", price_brl: 3000 }, mlWatchlist), true);
  assert.equal(matchesMercadoLivreWatchlist({ title: "Google Pixel Watch 5 45mm Wi-Fi", price_brl: 2401 }, mlWatchlist), false);
});
