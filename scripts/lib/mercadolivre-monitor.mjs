import fs from "node:fs/promises";
import path from "node:path";
import {
  normalizeMonitorCode,
} from "./monitor-core.mjs";

const ML_ORIGIN = "https://lista.mercadolivre.com.br";

export function buildSearchUrl(term, {
  minPrice,
  maxPrice,
  categoryPath = "",
  localShipping = false,
  filterSuffixes = [],
} = {}) {
  const slug = term.trim().replace(/\s+/g, "-");
  const priceFilter = Number.isFinite(minPrice) && Number.isFinite(maxPrice)
    ? `_PriceRange_${minPrice}BRL-${maxPrice}BRL_NoIndex_True`
    : "";
  const localShippingFilter = localShipping ? "_SHIPPING*ORIGIN_10215068" : "";
  const extraFilters = filterSuffixes.map((filter) => `_${filter}`).join("");
  const category = categoryPath ? `/${categoryPath.replace(/^\/|\/$/g, "")}` : "";
  return `${ML_ORIGIN}${category}/${encodeURIComponent(slug)}${priceFilter}${extraFilters}${localShippingFilter}`;
}

export function extractMercadoLivreId(url) {
  const value = String(url ?? "");
  const decoded = decodeURIComponent(value);
  const match = decoded.match(/[?&|=](?:item_id|wid)[:=](MLB\d{8,})\b/i)
    ?? value.match(/\/(MLB-\d{8,})\b/i)
    ?? value.match(/\b(MLB-?\d{8,})\b/i);
  return match ? match[1].replace("-", "").toUpperCase() : null;
}

export function extractMercadoLivreNotebookSpecs(specRows) {
  const rows = (specRows ?? []).map((row) =>
    String(row).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  );
  const ram = extractCapacity(rows, /^Capacidade total do modulo de memoria RAM\s*:?\s*(\d+(?:[.,]\d+)?)\s*GB$/i);
  const storage = extractCapacity(
    rows,
    /^(?:Capacidade de disco SSD|Capacidade de armazenamento de dados M2)\s*:?\s*(\d+(?:[.,]\d+)?)\s*(GB|TB)$/i,
    true,
  );
  const dedicatedGpuLine = extractField(rows, "Linha de placa grafica dedicada");
  const dedicatedGpuModel = extractField(rows, "Modelo de placa grafica dedicada");
  const integratedGpuModel = extractField(rows, "Modelo de placa grafica integrada");
  const integratedGpuBrand = extractField(rows, "Marca de placa grafica integrada");
  const integratedGpuLine = extractField(rows, "Linha de placa grafica integrada");
  const cpuModel = extractField(rows, "Modelo do processador");
  const gpu = formatGpu(dedicatedGpuLine, dedicatedGpuModel)
    ?? formatIntegratedGpu(integratedGpuBrand, integratedGpuLine, integratedGpuModel);
  return { ram, storage, gpu, cpuModel };
}

function extractField(rows, label) {
  const normalizedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${normalizedLabel}\\s*:?\\s*(.+)$`, "i");
  for (const row of rows) {
    const match = row.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function formatGpu(line, model) {
  if (!model) return null;
  const combined = `${line ?? ""} ${model}`.trim();
  const rtx = combined.match(/\bRTX\s*(\d{4})(?:\s*(Ti|Super))?\b/i)
    ?? (/\bRTX\b/i.test(line ?? "") ? model.match(/\b(\d{4})(?:\s*(Ti|Super))?\b/i) : null);
  if (rtx) return `RTX ${rtx[1]}${rtx[2] ? ` ${rtx[2].toUpperCase()}` : ""}`;
  const gtx = combined.match(/\bGTX\s*(\d{3,4})(?:\s*(Ti|Super))?\b/i);
  if (gtx) return `GTX ${gtx[1]}${gtx[2] ? ` ${gtx[2].toUpperCase()}` : ""}`;
  const radeon = combined.match(/\b(?:Radeon\s*)?(RX\s*\d{4}[A-Z]{0,2})\b/i);
  if (radeon) return `Radeon ${radeon[1].replace(/\s+/g, " ").toUpperCase()}`;
  return null;
}

function formatIntegratedGpu(brand, line, model) {
  const combined = `${brand ?? ""} ${line ?? ""} ${model ?? ""}`;
  if (/\bintel\b/i.test(combined) && /\barc\b/i.test(combined)) return "Intel Arc integrada";
  if (/\bradeon\b/i.test(combined)) return "Radeon integrada";
  if (/\biris\b/i.test(combined)) return "Intel Iris integrada";
  return null;
}

function extractCapacity(rows, pattern, hasUnit = false) {
  for (const row of rows) {
    const match = row.match(pattern);
    if (!match) continue;
    const value = Number(match[1].replace(",", "."));
    if (!Number.isFinite(value)) continue;
    return hasUnit && match[2].toUpperCase() === "TB" ? Math.round(value * 1024) : value;
  }
  return null;
}

export function textMatchesTerm(text, term) {
  const normalizedText = normalizeCode(text);
  const normalizedTerm = normalizeCode(term);
  return normalizedText.includes(normalizedTerm);
}

export function textMatchesAnyTermVariant(text, variants) {
  const normalizedText = normalizeCode(text);
  return variants.some((variant) => normalizedText.includes(normalizeCode(variant)));
}

export async function detectPageState(page) {
  const url = page.url();
  const title = await page.title().catch(() => "");
  const body = await page.locator("body").innerText().catch(() => "");
  const text = `${title}\n${body}`.toLowerCase();

  if (/login|registration|auth/.test(new URL(url).pathname)) return "logged_out";
  if (/captcha|verifique que voce e humano|verifique que você é humano|nao sou um robo|não sou um robô/.test(text)) return "challenge";
  if (/muitas solicitacoes|muitas solicitações|temporariamente indisponivel|temporariamente indisponível/.test(text)) return "limited";
  if (await page.locator("li.ui-search-layout__item, div.poly-card").count() > 0) return "results";
  if (/nao encontramos resultados|não encontramos resultados|sem resultados/.test(text)) return "empty";
  return "unknown";
}

export function pageStateMessage(state) {
  if (state === "logged_out") return "Sessao expirada. Abra o perfil e entre novamente.";
  if (state === "challenge") return "O Mercado Livre exibiu uma verificacao. Nada foi gravado.";
  if (state === "limited") return "O Mercado Livre limitou temporariamente os acessos. Nada foi gravado.";
  if (state === "empty") return "A busca retornou zero resultados; por seguranca, nada foi gravado.";
  return "Pagina de resultados nao reconhecida; nada foi gravado.";
}

export async function collectSearchResults(page) {
  const items = await page.locator("li.ui-search-layout__item, div.poly-card").evaluateAll((cards) => {
    const seen = new Set();
    const found = [];
    for (const card of cards) {
      const link = card.querySelector("a.poly-component__title, a.ui-search-link, a[href*='/p/MLB'], a[href*='MLB-']");
      const title =
        link?.getAttribute("title")?.trim() ||
        link?.textContent?.trim() ||
        card.querySelector("h2, h3")?.textContent?.trim() ||
        "";
      const url = link?.href || "";
      const currentPrice =
        card.querySelector(".poly-price__current .andes-money-amount") ||
        card.querySelector(".ui-search-price__second-line .andes-money-amount") ||
        card.querySelector(".andes-money-amount:not(.andes-money-amount--previous)");
      const fraction = currentPrice?.querySelector(".andes-money-amount__fraction")?.textContent ?? "";
      const cents = currentPrice?.querySelector(".andes-money-amount__cents")?.textContent ?? "";
      const price = Number(fraction.replace(/\D/g, "")) + (cents ? Number(cents.replace(/\D/g, "")) / 100 : 0);
      if (!title || !url || !Number.isFinite(price) || price <= 0 || seen.has(url)) continue;
      seen.add(url);
      found.push({ title, url, price_brl: price });
    }
    return found;
  });
  const unique = new Map();
  for (const item of items) {
    const normalized = {
      ...item,
      id: extractMercadoLivreId(item.url) ?? item.url,
    };
    const previous = unique.get(normalized.id);
    if (!previous || /produto\.mercadolivre\.com\.br|\/p\/MLB/i.test(normalized.url)) {
      unique.set(normalized.id, normalized);
    }
  }
  return [...unique.values()];
}

export async function latestMercadoLivreSnapshotPath(dataDir) {
  const entries = await fs.readdir(dataDir).catch(() => []);
  const latest = entries.filter((name) => /^snapshot-.*\.json$/.test(name)).sort().reverse()[0];
  return latest ? path.join(dataDir, latest) : null;
}

function normalizeCode(value) {
  return normalizeMonitorCode(value);
}
