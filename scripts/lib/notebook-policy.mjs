import { extractRamGb } from './parsers.mjs';
import { extractMercadoLivreNotebookSpecs } from './mercadolivre-monitor.mjs';
import { DEFAULT_CPU_TERMS } from './cpu-terms.mjs';
import { textContainsCpuTerm, normalizeText } from './parsers.mjs';

export const NOTEBOOK_MIN_RAM_GB = 32;
export const NOTEBOOK_POLICY_VERSION = 2;
export const NOTEBOOK_PRIORITY_CPUS = ['14700hx', '13980hx', '14900hx', '13900hx'];

export function notebookCpuTerms(text) {
  return DEFAULT_CPU_TERMS.filter(term => textContainsCpuTerm(text, term));
}

export function notebookExclusionReason(text) {
  const t = normalizeText(text)
    .replace(/\bsem\s+(?:nenhum\s+)?(?:defeitos?|problemas?|avarias?|reparos?)\b/g, '')
    .replace(/\b(?:nao|nunca)\s+(?:teve|apresentou|precisou\s+de)\s+(?:defeitos?|problemas?|avarias?|reparos?|conserto)\b/g, '');
  if (/^(?:notebook\s+)?(?:apple\s+)?macbook\b/.test(t.trim())) return 'MacBook fora da lista de processadores selecionados';
  if (/\b(?:sucata|defeito\w*|avaria\w*|quebrad[oa]\w*|nao\s+(?:liga|ligou|funciona)|queimad[oa]|queimou|surto\s+eletrico|retirada\s+de\s+pecas)\b/.test(t)) return 'Defeito ou avaria declarados no anúncio';
  if (/^(?:mini[ -]?pc|desktop|computador\s+de\s+mesa)\b|\b(?:vendo|venda\s+de)\s+(?:um\s+)?(?:mini[ -]?pc|desktop|computador\s+de\s+mesa)\b/.test(t)) return 'Equipamento fora da categoria notebook';
  if (/^(?:placa[ -]?mae|motherboard|carcaca|pecas)\b/.test(t.trim())
      || /\b(?:vendo|venda\s+de|somente|apenas|para\s+retirada\s+de)\s+(?:a\s+)?(?:placa[ -]?mae|motherboard|carcaca|pecas)\b/.test(t)) return 'Peça ou carcaça, não notebook completo';
  if (/\b(?:precisa\s+(?:de\s+)?(?:reparo|conserto)|com\s+problema)\b/.test(t)) return 'Reparo declarado no anúncio';
  return null;
}

export function hasExplicitOtherNotebookCpu(text) {
  const raw = String(text ?? '');
  if (/\bapple\s+(?:silicon|m[1-9]\d?)\b|\bmacbook[^\n]{0,40}\bm[1-9]\d?\b|\bsnapdragon\s+x\s*(?:elite|plus)\b/i.test(raw)) return true;
  const explicit = [...raw.matchAll(/\b(\d{4,5})[\s-]*(hx3d|hx|hs|hk|h|u)\b|\bultra\s*i?[579]\s*[- ]?(\d{3})[\s-]*(hx|h)\b|\b(\d{3})[\s-]*(hx)\b/gi)]
    .map(match => `${match[1] ?? match[3] ?? match[5]}${match[2] ?? match[4] ?? match[6]}`.toLowerCase());
  return explicit.some(term => !DEFAULT_CPU_TERMS.includes(term))
    || (!notebookCpuTerms(raw).length && /\b(?:i[3579]|ryzen\s*[3579])\s*[- ]\s*\d{4,5}\b/i.test(raw));
}

export function assessNotebook(item, description = item?.description ?? '') {
  const title = item?.title ?? item?.fullTitle ?? '';
  const specs = (item?.specs ?? []).join('\n');
  const text = `${title}\n${description}\n${specs}`;
  const reasons = [], warnings = [];
  const fields = [title, item?.listing_title, item?.detail_title, description, specs].filter(Boolean);
  const cpuGroups = fields.map(notebookCpuTerms).filter(terms => terms.length);
  const cpus = [...new Set(cpuGroups.flat())];
  if (cpus.length !== 1 || fields.some(field => hasExplicitOtherNotebookCpu(field))) reasons.push(cpus.length > 1 ? 'CPU divergente entre evidências' : 'CPU permitida não confirmada');
  const ram = notebookRamGb({ ...item, description });
  if (ram == null) reasons.push('RAM instalada não confirmada ou divergente');
  else if (ram < NOTEBOOK_MIN_RAM_GB) reasons.push(`RAM abaixo de ${NOTEBOOK_MIN_RAM_GB} GB`);
  const excluded = notebookExclusionReason(text);
  if (excluded) reasons.push(excluded);
  if (item?.identity_error) reasons.push(item.identity_error);
  if (!(Number(item?.price_brl) > 0)) reasons.push('Preço integral não confirmado');
  if (item?.price_error) reasons.push(item.price_error);
  if (!item?.storage_gb) warnings.push('Armazenamento não informado');
  else if (item.storage_gb > 16384) warnings.push('Capacidade de armazenamento inconsistente; conferir a unidade declarada');
  const rejected = Boolean(excluded || (ram != null && ram < NOTEBOOK_MIN_RAM_GB) || (!cpus.length && hasExplicitOtherNotebookCpu(text)));
  return { version: NOTEBOOK_POLICY_VERSION, state: rejected ? 'rejected' : reasons.length ? 'pending' : 'validated',
    cpu_terms: cpus, ram_gb: ram, reasons, warnings };
}

export function isEligibleNotebook(item) {
  // Older OLX snapshots retain the confirmed CPU and description check, not the
  // original description. Reuse that recorded evidence without a new visit.
  const recordedOlxCpu = item?.validation?.version === NOTEBOOK_POLICY_VERSION
    && item.validation.cpu_confirmed && item.validation.description_checked ? item.cpu_term ?? '' : '';
  const assessment = assessNotebook(item, `${item?.description ?? item?.description_evidence ?? ''}\n${recordedOlxCpu}`);
  if (assessment.state !== 'validated') return false;
  if (item?.notebook_validation && (item.notebook_validation.version !== NOTEBOOK_POLICY_VERSION || item.notebook_validation.state !== 'validated')) return false;
  if (item?.source === 'Mercado Livre' && (item.notebook_validation?.version !== NOTEBOOK_POLICY_VERSION
      || !Number.isFinite(Date.parse(item.details_checked_at)) || Date.now() - Date.parse(item.details_checked_at) > 24 * 3600_000)) return false;
  return true;
}

function notebookRamValues(text) {
  let cleaned = String(text ?? '')
    // Módulos originais entregues à parte não são a RAM instalada. Só retire
    // esse trecho quando o anúncio disser explicitamente que são originais.
    .replace(/\b(?:acompanha|inclui|vai\s+junto)\s*:?[^.!?\n]*(?:[.!?\n]|$)/gi, segment =>
      /\borigina(?:is|lmente|l)\b/i.test(segment) && /\b(?:ram|mem[oó]ria)\b/i.test(segment) ? '' : segment)
    .replace(/(?:suporta(?:\s+at[eé])?|expans[ií]vel(?:\s+(?:at[eé]|para))?|m[aá]ximo(?:\s+de)?|upgrade(?:\s+para)?)\s*:?\s*\d{1,3}\s*gb/gi, '')
    .replace(/\b(?:rtx|gtx|radeon|arc)\s*[\w-]+(?:\s+(?:ti|super))?\s*[-|/([]?\s*(?:com\s+)?\d{1,3}\s*gb\b(?!\s*(?:ram|ddr\d))/gi, '')
    .replace(/\b\d{1,3}\s*gb\s*(?:gddr\d\w*|vram|de\s+(?:video|vídeo))\b/gi, '')
    .replace(/\b(?:vram|mem[oó]ria\s+(?:de\s+)?v[ií]deo)\s*:?\s*\d{1,3}\s*gb\b/gi, '');
  cleaned = cleaned.replace(/\b([24])\s*[x×]\s*(\d{1,3})\s*gb\s*(?:\d{3,5}\s*(?:mhz|mt\/?s)\s*)?(?:ram|ddr[345])\b/gi, (_, count, size) => `${Number(count)*Number(size)} GB RAM`);
  const explicit = [...cleaned.matchAll(/\b(\d{1,3})\s*gb\s*(?:\d{3,5}\s*(?:mhz|mt\/?s)\s*)?(?:de\s*)?(?:ram|mem[oó]ria|ddr[345])\b|\b(?:mem[oó]ria\s+ram|ram|mem[oó]ria)\s*[:\r\n-]*\s*(\d{1,3})\s*gb\b/gi)]
    .map(match => Number(match[1] ?? match[2])).filter(value => value >= 2 && value <= 256);
  return [...new Set(explicit.length ? explicit : [extractRamGb(cleaned)].filter(value => value != null))];
}

export function extractNotebookRamText(text) {
  const values = notebookRamValues(text);
  return values.length === 1 ? values[0] : null;
}

export function notebookRamGb(item) {
  if (!item) return null;
  const structured = extractMercadoLivreNotebookSpecs(item.specs).ram;
  const stored = item.ram_gb == null ? null : Number(item.ram_gb);
  const titleRam = extractNotebookRamText(item.title ?? item.fullTitle);
  const descriptionRam = extractNotebookRamText(item.description ?? item.description_evidence);
  const listingRam = extractNotebookRamText(item.listing_title ?? item.detail_title);
  // Conflicting capacities require confirmation, rather than choosing the larger.
  const values = [structured, titleRam, descriptionRam, listingRam,
    ...notebookRamValues(item.description ?? item.description_evidence), ...notebookRamValues(item.title ?? item.fullTitle)]
    .filter(x => Number.isFinite(x) && x > 0);
  if (new Set(values).size > 1) return null;
  // O campo derivado de um snapshot antigo não deve contradizer a evidência
  // original após uma correção do parser. Divergências entre fontes permanecem pendentes.
  return values[0] ?? (Number.isFinite(stored) && stored > 0 ? stored : null);
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
    return isEligibleNotebook(item ?? { title: line });
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
