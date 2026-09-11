import { normalizeMonitorText } from "./monitor-core.mjs";
import { textMatchesAnyTermVariant } from "./mercadolivre-monitor.mjs";
import {
  ONEPLUS_BUDS_PRO3_BRAND_TERMS,
  ONEPLUS_BUDS_PRO3_EXCLUDE_TERMS,
  ONEPLUS_BUDS_PRO3_MATCH_VARIANTS,
  ONEPLUS_BUDS_PRO3_PRICE,
  ONEPLUS_BUDS_PRO3_SEARCH_TERMS,
} from "./oneplus-buds-pro-3.mjs";
import {
  GOOGLE_PIXEL_WATCH4_EXCLUDE_TERMS,
  GOOGLE_PIXEL_WATCH4_MATCH_VARIANTS,
  GOOGLE_PIXEL_WATCH4_PRICE,
  GOOGLE_PIXEL_WATCH4_TERMS,
  matchesGooglePixelWatch4,
} from "./google-pixel-watch-4.mjs";

export const mercadoLivreWatchlists = [
  {
    id: "galaxy-buds4-pro",
    label: "Galaxy Buds4 Pro",
    terms: ["galaxy buds4 pro"],
    matchVariants: ["galaxy buds4 pro", "buds4 pro", "buds 4 pro", "buds4pro"],
    minPrice: 500,
    maxPrice: 1000,
    relevantDetails: ["modelo", "condicao"],
    searchOptions: { localShipping: true },
  },
  {
    id: "google-pixel-watch-4",
    label: "Google Pixel Watch 4",
    terms: GOOGLE_PIXEL_WATCH4_TERMS,
    matchVariants: GOOGLE_PIXEL_WATCH4_MATCH_VARIANTS,
    minPrice: GOOGLE_PIXEL_WATCH4_PRICE.min,
    maxPrice: GOOGLE_PIXEL_WATCH4_PRICE.max,
    excludeTerms: GOOGLE_PIXEL_WATCH4_EXCLUDE_TERMS,
    itemFilter: matchesGooglePixelWatch4,
    relevantDetails: ["modelo", "tamanho", "conectividade", "condicao"],
    searchOptions: { localShipping: true },
  },
  {
    // Regras em lib/oneplus-buds-pro-3.mjs, compartilhadas com o monitor
    // OLX/Enjoei. Resumo: exclui a linha Nord (o "Nord Buds 3 Pro" tem nome
    // quase igual, só com os tokens invertidos) e exige a marca, senão
    // "Galaxy Buds3 Pro" e "Redmi Buds 3 Pro" entrariam.
    id: "oneplus-buds-pro-3",
    label: "OnePlus Buds Pro 3",
    terms: ONEPLUS_BUDS_PRO3_SEARCH_TERMS,
    matchVariants: ONEPLUS_BUDS_PRO3_MATCH_VARIANTS,
    minPrice: ONEPLUS_BUDS_PRO3_PRICE.min,
    maxPrice: ONEPLUS_BUDS_PRO3_PRICE.max,
    excludeTerms: ONEPLUS_BUDS_PRO3_EXCLUDE_TERMS,
    requiredAnyTerms: ONEPLUS_BUDS_PRO3_BRAND_TERMS,
    relevantDetails: ["modelo", "condicao"],
    searchOptions: { localShipping: true },
  },
  {
    id: "dockstations",
    label: "Dockstations",
    terms: ["SD25TB4", "WD22TB4"],
    minPrice: 0,
    maxPrice: 500,
    excludeTerms: ["fonte", "carregador", "cabo", "adaptador", "suporte"],
    relevantDetails: ["modelo", "portas", "fonte", "condicao"],
    searchOptions: { localShipping: true },
  },
  {
    id: "fitbit-air",
    label: "Fitbit Air",
    terms: ["fitbit air"],
    minPrice: 300,
    maxPrice: 600,
    excludeTerms: ["pulseira", "correa", "alca", "bracelete", "carregador", "cabo"],
    relevantDetails: ["modelo", "tamanho", "condicao"],
    searchOptions: { localShipping: true },
  },
  {
    id: "lifefactory",
    label: "Lifefactory",
    terms: ["lifefactory"],
    minPrice: 25,
    maxPrice: 75,
    excludeTerms: ["mamadeira"],
    minSizeMl: 500,
    maxSizeMl: 1000,
    relevantDetails: ["capacidade", "material", "condicao"],
    searchOptions: { localShipping: true },
  },
  {
    id: "tela-galaxybook3",
    label: "Tela Galaxy Book3",
    terms: ["BA96-08462A"],
    minPrice: 0,
    maxPrice: 1000,
    relevantDetails: ["codigo da peca", "compatibilidade", "condicao"],
    searchOptions: { localShipping: true },
  },
  {
    id: "melanger",
    label: "Melanger",
    terms: ["melanger"],
    minPrice: 1000,
    maxPrice: 5000,
    excludeTerms: ["220v", "220 v", "220volts", "220 volts"],
    keepTerms: ["110v", "110 v", "127v", "127 v", "bivolt", "bi-volt", "110/220", "110 / 220"],
    requiredAnyTerms: ["chocolate", "cacau", "moinho", "refinador"],
    relevantDetails: ["marca", "modelo", "capacidade", "voltagem", "condicao"],
    searchOptions: { localShipping: true },
  },
  {
    id: "oled-monitores",
    label: "Monitores OLED",
    terms: [
      "aw2726dm", "aw2725d", "aw2725df", "aw3225qf", "aw3423dw", "aw3423dwf", "aw3425dw",
      "odyssey g6 oled", "ls32dg800", "odyssey g9 oled",
      "cepheus p1",
      "mag 271qp", "mag 274qp", "mpg 491cqp",
      "27gx790a", "27gx704a",
      "xg27acdng",
    ],
    minPrice: 1500,
    maxPrice: 3000,
    relevantDetails: ["modelo", "tamanho", "taxa de atualizacao", "resolucao", "condicao"],
    searchOptions: { localShipping: true },
  },
  {
    id: "tenis-42",
    label: "Tenis 42",
    terms: ["vivobarefoot", "xero", "vibram fivefingers", "merrell", "lems", "feet of tomorrow"],
    minPrice: 0,
    maxPrice: 500,
    relevantDetails: ["marca", "modelo", "tamanho", "condicao"],
    searchOptions: {
      categoryPath: "calcados-roupas-bolsas/calcados/masculino",
      filterSuffixes: ["FILTRABLE*SIZE_12189541_NoIndex_True"],
      localShipping: true,
    },
  },
];

export function matchesMercadoLivreWatchlist(item, watchlist) {
  const text = normalize(`${item.title ?? ""} ${item.detailsText ?? ""}`);
  const exclusions = (watchlist.excludeTerms ?? []).map(normalize);
  const keep = (watchlist.keepTerms ?? []).map(normalize);
  if (exclusions.some((term) => text.includes(term)) && !keep.some((term) => text.includes(term))) return false;
  if ((watchlist.requiredTerms ?? []).some((term) => !text.includes(normalize(term)))) return false;
  if (watchlist.requiredAnyTerms?.length && !watchlist.requiredAnyTerms.some((term) => text.includes(normalize(term)))) return false;
  if (watchlist.itemFilter && !watchlist.itemFilter(item)) return false;

  if (watchlist.minSizeMl != null || watchlist.maxSizeMl != null) {
    const size = extractCapacityMl(text);
    if (size != null && watchlist.minSizeMl != null && size < watchlist.minSizeMl) return false;
    if (size != null && watchlist.maxSizeMl != null && size > watchlist.maxSizeMl) return false;
  }
  return true;
}

export function mercadoLivreWatchlistTermMatcher(watchlist) {
  if (!watchlist.matchVariants?.length) return null;
  return (text) => textMatchesAnyTermVariant(text, watchlist.matchVariants);
}

function extractCapacityMl(text) {
  const match = text.match(/\b(\d+(?:[.,]\d+)?)\s*(ml|l)\b/i);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  return match[2].toLowerCase() === "l" ? Math.round(value * 1000) : Math.round(value);
}

function normalize(value) {
  return normalizeMonitorText(value);
}
