import { formatBrlPrice, parseBrlPrice } from "./parsers.mjs";

export function runTimestampFromFile(file) {
  const m = file.match(/report(?:-premium)?-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.md$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function createDashboardParser({ summarizeMachine, formatDateTimeBrt, priceCapBrl = 10000, maxItems = 5 }) {
  function parseReport(txt, detailsByUrl = new Map()) {
    const dateM = txt.match(/Data:\s*(\d{4}-\d{2}-\d{2})/) ?? txt.match(/[—\-]\s*(\d{4}-\d{2}-\d{2})/);
    const date = dateM ? dateM[1] : null;
    const withinCap = (item) => {
      const p = parseBrlPrice(item.priceTo ?? item.price);
      return p == null || p <= priceCapBrl;
    };
    const newItems = extractItems(txt, /^## Novos (an[úu]ncios|produtos|notebooks)/m, detailsByUrl).filter(withinCap);
    const priceItems = extractItems(txt, /^## Mudan[cç]as? de pre[cç]o/m, detailsByUrl).filter(withinCap);
    return {
      newCount: newItems.length,
      priceCount: priceItems.length,
      date,
      newItems: newItems.slice(0, maxItems),
      priceItems: priceItems.slice(0, maxItems),
      allNewItems: newItems,
      allPriceItems: priceItems,
      partial: /Cobertura parcial:\s*\*\*sim\*\*/i.test(txt),
    };
  }

  function extractItems(txt, sectionRe, detailsByUrl = new Map()) {
    const m = txt.match(sectionRe);
    if (!m) return [];
    const rest = txt.slice(m.index);
    const nextSec = rest.slice(1).search(/^## /m);
    const block = nextSec === -1 ? rest : rest.slice(0, nextSec + 1);
    return block
      .split("\n")
      .filter((line) => line.startsWith("- ") && !/Nenhum|Observa[cç]|CPUs? exclu/i.test(line))
      .map((line) => parseLine(line, detailsByUrl));
  }

  function parseLine(line, detailsByUrl = new Map()) {
    const raw = line.slice(2).trim();
    const urlM = raw.match(/https?:\/\/\S+/);
    const url = urlM ? urlM[0].replace(/[.,)]+$/, "") : null;
    const changeM = raw.match(/(R\$\s*[\d.,]+)\s*(?:→|->)\s*(R\$\s*[\d.,]+)/);
    const priceM = raw.match(/R\$\s*[\d.,]+/);
    const priceFrom = changeM ? formatBrlPrice(changeM[1].trim()) : null;
    const priceTo = changeM ? formatBrlPrice(changeM[2].trim()) : null;
    const price = priceM ? formatBrlPrice(priceM[0]) : null;
    let title = raw;
    if (url) title = title.replace(url, "");
    if (changeM) title = title.replace(changeM[0], "");
    else if (priceM) title = title.replace(priceM[0], "");
    title = title.replace(/^\s*[—–\-,\s]+/, "").replace(/[—–\-,\s]+$/, "");
    const fullTitle = title || "—";
    const shortTitle = fullTitle.length > 72 ? fullTitle.slice(0, 72) + "…" : fullTitle;
    return { title: shortTitle, fullTitle, price, url, priceFrom, priceTo, machine: summarizeMachine(fullTitle, url ? detailsByUrl.get(url) : null) };
  }

  function formatRunLabelFromFile(file, fallbackDate) {
    const m = file.match(/report(?:-premium)?-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.md$/);
    if (!m) {
      const fallback = String(fallbackDate ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return fallback ? `${fallback[3]}/${fallback[2]}/${fallback[1]}` : "—";
    }
    const [, year, month, day, hour, minute, second, ms] = m;
    const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}Z`);
    return Number.isNaN(date.getTime()) ? "—" : formatDateTimeBrt(date);
  }

  return { parseReport, formatRunLabelFromFile };
}
