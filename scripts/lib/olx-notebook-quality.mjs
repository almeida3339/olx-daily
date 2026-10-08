import { extractRamGb, extractStorageGb, extractGpuLabel, normalizeText, parseBrlPrice, textContainsCpuTerm } from './parsers.mjs';

export const OLX_QUALITY_VERSION = 1;
export const OLX_PRIORITY_CPUS = ['14700hx', '13980hx', '14900hx', '13900hx', '12900hx', '12800hx'];

export function orderOlxCpuTerms(terms) {
  return [...new Set([...OLX_PRIORITY_CPUS.filter(t => terms.includes(t)), ...terms])];
}

export function planOlxCpuTerms(terms, previous, { now = Date.now(), lowPriorityIntervalMs = 24 * 3600_000, fullSweep = false } = {}) {
  return orderOlxCpuTerms(terms).filter(term => fullSweep || OLX_PRIORITY_CPUS.includes(term)
    || (previous?.coverage_status?.[term]?.state && previous.coverage_status[term].state !== 'success')
    || !Number.isFinite(Date.parse(previous?.coverage_status?.[term]?.last_success_at))
    || now - Date.parse(previous.coverage_status[term].last_success_at) >= lowPriorityIntervalMs);
}

// RAM do sistema: remover a capacidade que pertence à GPU antes de aplicar o
// parser existente. O texto continua disponível para extrair a GPU separadamente.
export function extractOlxRam(text) {
  const cleaned = String(text ?? '')
    .replace(/\b(?:rtx|gtx|radeon|arc)\s*[\w-]+(?:\s+(?:ti|super))?\s*[-|/([]?\s*(?:com\s+)?\d{1,3}\s*gb\b(?!\s*(?:ram|ddr\d))/gi, '')
    .replace(/\b\d{1,3}\s*gb\s*(?:gddr\d\w*|vram|de\s+(?:video|vídeo))\b/gi, '')
    .replace(/\b(?:vram|mem[oó]ria\s+(?:de\s+)?v[ií]deo)\s*:?\s*\d{1,3}\s*gb\b/gi, '');
  return extractRamGb(cleaned);
}

export function olxSpecs(text) {
  return { ram_gb: extractOlxRam(text), storage_gb: extractStorageGb(text), gpu: extractGpuLabel(text) };
}

export function notebookExclusionReason(text) {
  const t = normalizeText(text)
    .replace(/\bsem\s+(?:nenhum\s+)?(?:defeitos?|problemas?|avarias?|reparos?)\b/g, '')
    .replace(/\b(?:nao|nunca)\s+(?:teve|apresentou|precisou\s+de)\s+(?:defeitos?|problemas?|avarias?|reparos?|conserto)\b/g, '');
  const defects = /\b(?:sucata|defeito\w*|avaria\w*|quebrad[oa]\w*|nao\s+(?:liga|ligou|funciona)|queimad[oa]|queimou|surto\s+eletrico|retirada\s+de\s+pecas)\b/;
  if (defects.test(t)) return 'Defeito ou avaria declarados no anúncio';
  if (/^(?:mini[ -]?pc|desktop|computador\s+de\s+mesa)\b|\b(?:vendo|venda\s+de)\s+(?:um\s+)?(?:mini[ -]?pc|desktop|computador\s+de\s+mesa)\b/.test(t)) return 'Equipamento fora da categoria notebook';
  if (/^(?:placa[ -]?mae|motherboard|carcaca|pecas)\b/.test(t.trim())) return 'Peça ou carcaça, não notebook completo';
  if (/\b(?:vendo|venda\s+de|somente|apenas|para\s+retirada\s+de)\s+(?:a\s+)?(?:placa[ -]?mae|motherboard|carcaca|pecas)\b/.test(t)) return 'Peça ou carcaça, não notebook completo';
  if (/\b(?:precisa\s+(?:de\s+)?(?:reparo|conserto)|com\s+problema)\b/.test(t)) return 'Reparo declarado no anúncio';
  return null;
}

export function assertOlxAccessible(text) {
  if (/fa[cç]a login para continuar|sess[aã]o expirada/i.test(text ?? '')) {
    const error = new Error('OLX exige login; coleta interrompida.'); error.pageState = 'logged_out'; throw error;
  }
  if (/you have been blocked|unable to access|cloudflare|attention required|verifique que voce|verifique que você|captcha|just a moment|verify you are human/i.test(text ?? '')) {
    const error = new Error('OLX exige verificação ou bloqueou o acesso; coleta interrompida.');
    error.pageState = 'challenge';
    throw error;
  }
  if (/muitas solicita[cç][oõ]es|too many requests/i.test(text ?? '')) {
    const error = new Error('OLX limitou os acessos; coleta interrompida.');
    error.pageState = 'limited';
    throw error;
  }
}

// Executada dentro da página, sem variáveis externas. Ler somente preço e
// descrição do anúncio; preço do corpo completo pode ser uma parcela ou sugestão.
export function readOlxNotebookDetail() {
  const products = [];
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if ([].concat(value['@type'] ?? []).includes('Product')) products.push(value);
    if (value['@graph']) walk(value['@graph']);
  };
  document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
    try { walk(JSON.parse(el.textContent)); } catch { /* bloco não JSON */ }
  });
  const id = location.pathname.match(/(\d{8,})$/)?.[1];
  const product = products.find(p => String(p.url ?? p['@id'] ?? '').includes(id ?? '__missing__'))
    ?? (products.length === 1 && !products[0].url && !products[0]['@id'] ? products[0] : null);
  const offer = [].concat(product?.offers ?? []).find(o => !o.priceCurrency || o.priceCurrency === 'BRL');
  const visible = selector => Array.from(document.querySelectorAll(selector)).find(el => el.getClientRects().length)?.innerText?.trim();
  const description = visible('[data-testid="ad-description"], [data-testid="ad-description-description"], #ad-description')
    || product?.description || '';
  const priceText = visible('[data-testid="ad-price"], [data-testid="price-value"], [data-testid="ad-price-value"]');
  return {
    url: location.href, title: product?.name || document.querySelector('h1')?.innerText || '',
    description: typeof description === 'string' ? new DOMParser().parseFromString(description, 'text/html').body.textContent.trim() : '', price_text: priceText ?? null,
    structured_price: offer?.price ?? null,
    body_text: (document.body?.innerText ?? '').slice(0, 6000),
  };
}

function numericPrice(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && value.includes('R$')) return parseBrlPrice(value);
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function pendingOlxItem(item, reason) {
  return { ...item, desc_checked: false, validation: { version: OLX_QUALITY_VERSION, state: 'pending', checked_at: new Date().toISOString(), reasons: [reason] } };
}

export function validateOlxNotebook(card, detail, now = new Date()) {
  assertOlxAccessible(detail.body_text);
  const text = `${card.title}\n${detail.title}\n${detail.description}`;
  const reasons = [];
  if (detail.url && new URL(detail.url).pathname.match(/\/(?:login|entrar)(?:\/|$)/i)) {
    const error = new Error('OLX redirecionou para login'); error.pageState = 'logged_out'; throw error;
  }
  if (detail.url && new URL(detail.url).pathname.match(/\d{8,}$/)?.[0] !== new URL(card.url).pathname.match(/\d{8,}$/)?.[0]) reasons.push('Página aberta não corresponde ao anúncio');
  const excluded = notebookExclusionReason(text);
  const cpuConfirmed = textContainsCpuTerm(`${detail.title}\n${detail.description}`, card.cpu_term);
  const domPrice = numericPrice(detail.price_text), jsonPrice = numericPrice(detail.structured_price);
  const price = domPrice ?? jsonPrice;
  const discrepancy = (a, b) => a != null && b != null && Math.abs(a - b) > 1;
  if (!detail.description.trim()) reasons.push('Descrição do anúncio não localizada');
  if (price == null) reasons.push('Preço integral do anúncio não localizado');
  if (discrepancy(price, card.price_brl)) reasons.push('Preço da listagem diverge do detalhe');
  if (discrepancy(domPrice, jsonPrice)) reasons.push('Preços visível e estruturado divergem');
  if (price != null && [...text.matchAll(/(?:entrada|sinal|parcelas?\s*(?:de|por)?|\d{1,2}\s*x\s*(?:de)?)\s*[:\-]?\s*R\$\s*([\d.,]+)/gi)]
    .some(m => Math.abs((parseBrlPrice(`R$ ${m[1]}`) ?? -1) - price) <= 1)) reasons.push('Preço pode representar entrada ou parcela');
  const titleSpecs = olxSpecs(`${card.title}\n${detail.title}`), descSpecs = olxSpecs(detail.description);
  const specs = {};
  for (const key of ['ram_gb', 'storage_gb', 'gpu']) {
    const label = { ram_gb: 'RAM', storage_gb: 'SSD/armazenamento', gpu: 'GPU' }[key];
    if (titleSpecs[key] != null && descSpecs[key] != null && titleSpecs[key] !== descSpecs[key]) reasons.push(`Especificação divergente: ${label}`);
    specs[key] = descSpecs[key] ?? titleSpecs[key];
    if (specs[key] == null) reasons.push(`Especificação não confirmada: ${label}`);
  }
  if (!cpuConfirmed) reasons.push('CPU não confirmada no anúncio');
  const rejected = excluded || (detail.description.trim() && detail.title && !cpuConfirmed);
  if (rejected) reasons.unshift(excluded ?? 'CPU fora da busca');
  return {
    ...card, ...specs, price_brl: price ?? card.price_brl, desc_checked: Boolean(detail.description.trim()),
    validation: { version: OLX_QUALITY_VERSION, state: rejected ? 'rejected' : reasons.length ? 'pending' : 'validated',
      checked_at: now.toISOString(), reasons, listing_price_brl: card.price_brl,
      detail_price_brl: price, visible_price_brl: domPrice, structured_price_brl: jsonPrice,
      title_specs: titleSpecs, description_specs: descSpecs,
      cpu_confirmed: cpuConfirmed, description_checked: Boolean(detail.description.trim()) },
  };
}

export function isValidatedOlxItem(item) {
  return item?.validation?.version === OLX_QUALITY_VERSION && item.validation.state === 'validated';
}
