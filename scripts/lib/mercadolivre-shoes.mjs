import { classifyBarefootShoe } from './shoe-search-rules.mjs';

export const ML_SHOE_POLICY_VERSION = 1;
export function assessMercadoLivreShoe(item) {
  const specs = item.specs ?? [];
  const brand = item.brand ?? specs.find(row => /^marca\s*:/i.test(row))?.replace(/^marca\s*:\s*/i, '');
  const barefoot = classifyBarefootShoe({ ...item, brand }, `${item.description ?? ''}\n${specs.join('\n')}`);
  const rows = (item.specs ?? []).filter(row => /^(?:tamanho(?:\s+do\s+cal[cç]ado)?|numera[cç][aã]o|n[uú]mero)\s*:/i.test(row));
  const titleSizes = [item.title, item.listing_title, item.detail_listing_title].filter(Boolean)
    .flatMap(title => [...title.matchAll(/\b(?:tam(?:anho)?\.?|n[uú]mero|numera[cç][aã]o)\s*:?\s*(\d{2})(?:\s*(BR|US|EU|EUR|UK))?\b/gi)].map(match => match[0]));
  const evidence = [...rows, ...titleSizes];
  const sizes = evidence.filter(row => !/\b(?:US|USA|EU|EUR|UK|americano|europeu)\b/i.test(row))
    .flatMap(row => [...row.matchAll(/\b([3-4]\d)\b/g)].map(match => Number(match[1])));
  const unique = [...new Set(sizes)];
  const reasons = [];
  if (barefoot.state !== 'confirmed') reasons.push(barefoot.reason);
  if (unique.length !== 1) reasons.push('Numeração brasileira selecionada não confirmada ou divergente');
  else if (unique[0] !== 42) reasons.push('Numeração brasileira diferente de 42');
  if (evidence.some(row => /\b(?:US|USA|EU|EUR|UK|americano|europeu)\b/i.test(row))) reasons.push('Numeração estrangeira exige confirmação de equivalência pelo fabricante');
  if (item.identity_error) reasons.push(item.identity_error);
  if (item.price_error) reasons.push(item.price_error);
  if (!(Number(item.price_brl) > 0) || Number(item.price_brl) > 500) reasons.push('Preço fora da faixa até R$ 500');
  return { version: ML_SHOE_POLICY_VERSION, state: barefoot.state === 'rejected' || (unique.length === 1 && unique[0] !== 42)
    ? 'rejected' : reasons.length ? 'pending' : 'validated', size_br: unique.length === 1 ? unique[0] : null, reasons };
}

export function hasMercadoLivreShoeEvidence(item) {
  return Boolean(item && item.shoe_validation?.version === ML_SHOE_POLICY_VERSION
    && item.shoe_validation.state === 'validated'
    && Number.isFinite(Date.parse(item.details_checked_at))
    && assessMercadoLivreShoe(item).state === 'validated');
}

export function isApprovedMercadoLivreShoe(item) {
  return hasMercadoLivreShoeEvidence(item) && Date.now() - Date.parse(item.details_checked_at) < 24 * 3600_000;
}

export function filterMercadoLivreShoeReport(report, itemsByUrl) {
  let section = '', newCount = 0, priceCount = 0;
  const lines = report.split('\n').filter(line => {
    if (line.startsWith('## ')) section = line;
    if (!/^## (?:Novos|Mudan[cç]as|Entraram)/.test(section) || !line.startsWith('- ')) return true;
    const url = line.match(/https?:\/\/\S+/)?.[0];
    if (!url) return true;
    if (!isApprovedMercadoLivreShoe(itemsByUrl.get(url))) return false;
    if (/^## Novos/.test(section)) newCount++;
    if (/^## Mudan/.test(section)) priceCount++;
    return true;
  });
  return lines.map(line => /^Novos produtos:/.test(line) ? line.replace(/\*\*\d+\*\*/, `**${newCount}**`)
    : /^Altera[cç][oõ]es de pre[cç]o:/.test(line) ? line.replace(/\*\*\d+\*\*/, `**${priceCount}**`) : line).join('\n');
}
