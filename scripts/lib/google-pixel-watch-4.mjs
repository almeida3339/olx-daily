// Regras do Google Pixel Watch 4 (45 mm), compartilhadas pelo monitor OLX/
// Enjoei e pela watchlist do Mercado Livre.
//
// O teto depende da conectividade declarada no anúncio:
//   Wi-Fi/Bluetooth (ou sem conectividade declarada) -> R$ 2.000
//   4G LTE/celular                                     -> R$ 2.500
// Anúncios sem tamanho explícito não entram: a watchlist é exclusivamente da
// versão de 45 mm, para não misturar o modelo de 41 mm.
import { normalizeMonitorCode, normalizeMonitorText } from "./monitor-core.mjs";

export const GOOGLE_PIXEL_WATCH4_PRICE = Object.freeze({
  min: 0,
  max: 2500,
  wifiMax: 2000,
  lteMax: 2500,
});

export const GOOGLE_PIXEL_WATCH4_TERMS = ["pixel watch 4"];
export const GOOGLE_PIXEL_WATCH4_MATCH_VARIANTS = ["pixel watch 4"];
export const GOOGLE_PIXEL_WATCH4_EXCLUDE_TERMS = [
  "capa", "capinha", "pelicula", "película", "pulseira", "bracelete", "band",
  "strap", "carregador", "cabo", "suporte", "case", "protetor",
];

export function hasGooglePixelWatch4Model(text) {
  return normalizeMonitorCode(text).includes("pixelwatch4");
}

export function isPixelWatch45mm(text) {
  const normalized = normalizeMonitorText(text);
  const has45 = /\b45\s*-?\s*(?:mm|milimetros?)\b/.test(normalized);
  const hasOtherSize = /\b(?:40|41)\s*-?\s*(?:mm|milimetros?)\b/.test(normalized);
  return has45 && !hasOtherSize;
}

export function isPixelWatchLte(text) {
  return /\b(?:lte|4g|cellular|celular)\b/.test(normalizeMonitorText(text));
}

export function pixelWatch4MaxPrice(text) {
  return isPixelWatchLte(text)
    ? GOOGLE_PIXEL_WATCH4_PRICE.lteMax
    : GOOGLE_PIXEL_WATCH4_PRICE.wifiMax;
}

export function matchesGooglePixelWatch4({ title = "", price_brl: price } = {}) {
  const text = String(title ?? "");
  const normalized = normalizeMonitorText(text);
  const numericPrice = Number(price);
  if (GOOGLE_PIXEL_WATCH4_EXCLUDE_TERMS.some((term) => normalized.includes(normalizeMonitorText(term)))) return false;
  return hasGooglePixelWatch4Model(text)
    && isPixelWatch45mm(text)
    && Number.isFinite(numericPrice)
    && numericPrice >= GOOGLE_PIXEL_WATCH4_PRICE.min
    && numericPrice <= pixelWatch4MaxPrice(text);
}
