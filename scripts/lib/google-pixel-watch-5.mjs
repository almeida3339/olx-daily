// Regras do Google Pixel Watch 5 (45 mm), compartilhadas pelo monitor OLX/
// Enjoei e pela watchlist do Mercado Livre.
//
// Wi-Fi/Bluetooth (ou conectividade não declarada) custa até R$ 2.400;
// 4G/LTE/celular custa até R$ 3.000. O tamanho precisa estar explícito para
// impedir que a versão de 41 mm entre na mesma busca.
import { normalizeMonitorCode, normalizeMonitorText } from "./monitor-core.mjs";

export const GOOGLE_PIXEL_WATCH5_PRICE = Object.freeze({
  min: 0,
  max: 3000,
  wifiMax: 2400,
  lteMax: 3000,
});

export const GOOGLE_PIXEL_WATCH5_TERMS = ["pixel watch 5"];
export const GOOGLE_PIXEL_WATCH5_MATCH_VARIANTS = ["pixel watch 5"];
export const GOOGLE_PIXEL_WATCH5_EXCLUDE_TERMS = [
  "capa", "capinha", "pelicula", "película", "pulseira", "bracelete", "band",
  "strap", "carregador", "cabo", "suporte", "case", "protetor",
];

export function hasGooglePixelWatch5Model(text) {
  return normalizeMonitorCode(text).includes("pixelwatch5");
}

export function isPixelWatch5_45mm(text) {
  const normalized = normalizeMonitorText(text);
  const has45 = /\b45\s*-?\s*(?:mm|milimetros?)\b/.test(normalized);
  const hasOtherSize = /\b(?:40|41)\s*-?\s*(?:mm|milimetros?)\b/.test(normalized);
  return has45 && !hasOtherSize;
}

export function isPixelWatch5Lte(text) {
  return /\b(?:lte|4g|cellular|celular)\b/.test(normalizeMonitorText(text));
}

export function pixelWatch5MaxPrice(text) {
  return isPixelWatch5Lte(text)
    ? GOOGLE_PIXEL_WATCH5_PRICE.lteMax
    : GOOGLE_PIXEL_WATCH5_PRICE.wifiMax;
}

export function matchesGooglePixelWatch5({ title = "", price_brl: price } = {}) {
  const text = String(title ?? "");
  const normalized = normalizeMonitorText(text);
  const numericPrice = Number(price);
  if (GOOGLE_PIXEL_WATCH5_EXCLUDE_TERMS.some((term) => normalized.includes(normalizeMonitorText(term)))) return false;
  return hasGooglePixelWatch5Model(text)
    && isPixelWatch5_45mm(text)
    && Number.isFinite(numericPrice)
    && numericPrice >= GOOGLE_PIXEL_WATCH5_PRICE.min
    && numericPrice <= pixelWatch5MaxPrice(text);
}
