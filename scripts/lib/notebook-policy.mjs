import { extractRamGb } from './parsers.mjs';
import { extractMercadoLivreNotebookSpecs } from './mercadolivre-monitor.mjs';

export const NOTEBOOK_MIN_RAM_GB = 32;

export function extractNotebookRamText(text) {
  const cleaned = String(text ?? '')
    .replace(/(?:suporta(?:\s+at[eé])?|expans[ií]vel(?:\s+(?:at[eé]|para))?|m[aá]ximo(?:\s+de)?|upgrade(?:\s+para)?)\s*:?\s*\d{1,3}\s*gb/gi, '')
    .replace(/\b(?:rtx|gtx|radeon|arc)\s*[\w-]+(?:\s+(?:ti|super))?\s*[-|/([]?\s*(?:com\s+)?\d{1,3}\s*gb\b(?!\s*(?:ram|ddr\d))/gi, '')
    .replace(/\b\d{1,3}\s*gb\s*(?:gddr\d\w*|vram|de\s+(?:video|vídeo))\b/gi, '')
    .replace(/\b(?:vram|mem[oó]ria\s+(?:de\s+)?v[ií]deo)\s*:?\s*\d{1,3}\s*gb\b/gi, '');
  const modules = cleaned.match(/\b([24])\s*[x×]\s*(\d{1,3})\s*gb\s*(?:ram|ddr[345])\b/i);
  if (modules) return Number(modules[1]) * Number(modules[2]);
  return extractRamGb(cleaned);
}

export function notebookRamGb(item) {
  if (!item) return null;
  const structured = extractMercadoLivreNotebookSpecs(item.specs).ram;
  const stored = item.ram_gb == null ? null : Number(item.ram_gb);
  const titleRam = extractNotebookRamText(item.title ?? item.fullTitle);
  // Conflicting capacities require confirmation, rather than choosing the larger.
  const values = [structured, stored, titleRam].filter(x => Number.isFinite(x) && x > 0);
  if (new Set(values).size > 1) return null;
  return values[0] ?? null;
}

export function meetsNotebookRamMinimum(item) {
  const ram = notebookRamGb(item);
  return ram != null && ram >= NOTEBOOK_MIN_RAM_GB;
}

// Apply the current preference when reusing an older report, without rewriting history.
export function filterNotebookReportRam(report, detailsByUrl = new Map()) {
  if (!report) return report;
  const lines = report.split('\n').filter(line => {
    if (!line.startsWith('- ')) return true;
    const url = line.match(/https?:\/\/\S+/)?.[0]?.replace(/[.,)]+$/, '');
    if (!url) return true;
    const item = detailsByUrl.get(url);
    return meetsNotebookRamMinimum(item ?? { title: line });
  });
  const count = heading => {
    let active = false, total = 0;
    for (const line of lines) {
      if (line.startsWith('## ')) active = heading.test(line);
      else if (active && line.startsWith('- ') && /https?:\/\//.test(line)) total++;
    }
    return total;
  };
  const counts = [
    [/^(?:- )?Novos (?:an[úu]ncios(?: v[aá]lidos)?|notebooks|produtos)[^:]*:/, count(/^## Novos /)],
    [/^(?:- )?Altera[cç][oõ]es de pre[cç]o[^:]*:/, count(/^## Mudan[cç]as? de pre[cç]o/)],
    [/^(?:- )?Entraram na faixa do monitor[^:]*:/, count(/^## Entraram na faixa/)],
  ];
  return lines.map(line => {
    for (const [pattern, total] of counts) if (pattern.test(line)) return line.replace(/\*\*\d+\*\*/, `**${total}**`);
    return line;
  }).join('\n');
}
