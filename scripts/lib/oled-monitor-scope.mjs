import { normalizeMonitorText } from './monitor-core.mjs';
import { isOlxRecommendationUrl } from './olx-listing.mjs';

export const OLED_POLICY_VERSION = 3;
export const OLED_PRICE = { min: 1500, max: 3000 };
export const OLED_DETAIL_TTL_MS = 24 * 3600_000;
const codes = ['aw2726dm','aw2725d','aw2725df','aw3225qf','aw3423dw','aw3423dwf','aw3425dw',
  '27gx790a','27gx704a','27gr95qe','27gs95qe','39gs95qe','xg27acdng',
  'mag271qpx','mag271qpx24','mag274qpx24','mpg491cqp','q27g4zdr'];
// AOC official specification: QD-OLED, 2560x1440, 240 Hz.
// https://www.aoc.com/ca-en/gaming/monitors/q27g4zdr
export const OLED_MODELS = codes.map(id => ({ id, label: id.toUpperCase() }));
export const OLED_SEARCH_TERMS = ['aw2726dm','aw2725d','aw2725df','aw3225qf','aw3423dw','aw3423dwf','aw3425dw',
  'odyssey oled g6','ls32dg800','odyssey oled g9','monitor cepheus','mag 271qp','mag 274qp','mpg 491cqp',
  '27gx790a','27gx704a','27gr95qe','27gs95qe','39gs95qe','xg27acdng','monitor oled'];
export function normalizeOledSearchTerm(value) {
  const term=String(value).toLowerCase().trim();
  return {'odyssey g6 oled':'odyssey oled g6','odyssey g9 oled':'odyssey oled g9','cepheus p1':'monitor cepheus'}[term]??term;
}

function codePattern(code) {
  return new RegExp(`(^|[^a-z0-9])${code.split('').join('[\\s._-]*')}(?=$|[^a-z0-9])`, 'i');
}
export function oledModelIds(text) {
  const t = normalizeMonitorText(text);
  const codeText = t.replace(/\bqd[ -]?oled\b/g, ' ');
  const found = OLED_MODELS.filter(model => codePattern(model.id).test(codeText)).map(model => model.id);
  if (/\bcepheus\s*p1\b/.test(t)) found.push('cepheus-p1');
  for (const [family, pattern] of [
    ['samsung-oled-g6', /\b(?:g60sd|g61sd|g60sf|ls27dg60\d[a-z0-9]*|ls27fg60\d[a-z0-9]*)\b/],
    ['samsung-oled-g8', /\b(?:g80sd|g81sf|ls32dg80\d[a-z0-9]*|ls34bg85\d[a-z0-9]*)\b/],
    ['samsung-oled-g9', /\b(?:g93sc|g95sc|g93sd|g95sd|ls49cg9[35]\d[a-z0-9]*|ls49dg9[35]\d[a-z0-9]*)\b/],
  ]) {
    const g = family.at(-1);
    if (pattern.test(t) || (/\b(?:samsung|odyssey)\b/.test(t) && /\b(?:qd[ -]?)?oled\b/.test(t) && new RegExp(`\\bg${g}\\b`).test(t))) found.push(family);
  }
  return [...new Set(found)];
}

function defectReason(text) {
  const t = normalizeMonitorText(text)
    .replace(/\bsem\s+(?:(?:qualquer(?:\s+tipo\s+de)?|nenhum(?:\s+tipo\s+de)?|nenhuma|sinais?\s+de|marcas?\s+de)\s+)?(?:burn[ -]?in|defeitos?|avarias?|manchas?|riscos?|pixels?\s+mortos?)\b/g, '')
    .replace(/\b(?:nao|nunca)\s+(?:tem|teve|possui|apresenta|apresentou)\s+(?:burn[ -]?in|defeitos?|avarias?|manchas?|riscos?)\b/g, '')
    .replace(/\b(?:garantia|protecao|prevencao|cobertura)\s+(?:de\s+\d+\s+\w+\s+)?(?:contra|para|de)\s+(?:burn[ -]?in|defeitos?(?:\s+de\s+fabricacao)?)\b/g, '');
  if (/\b(?:defeito\w*|avaria\w*|sucata|burn[ -]?in|quebrad[oa]|trincad[oa]|pixels?\s+mortos?|nao\s+(?:liga|funciona)|(?:com|apresenta|possui|tem)\s+(?:uma?\s+)?(?:manchas?|linhas?\s+(?:na\s+)?tela)|retirada\s+de\s+pecas)\b/.test(t)) return 'Defeito ou avaria declarados';
  return null;
}

export function assessOledMonitor(item, { requireDetail = true } = {}) {
  const title = normalizeMonitorText(item?.title ?? item?.fullTitle ?? '').trim();
  const text = [item?.title ?? item?.fullTitle, item?.listing_title, item?.detail_title,
    item?.description_evidence ?? item?.description, ...(item?.specs ?? [])].filter(Boolean).join('\n');
  const t = normalizeMonitorText(text), reasons = [], warnings = [];
  const models = oledModelIds(text);
  const part = /^(?:pecas?|controle\s+remoto|placas?(?:[- ](?:principal|fonte|logica|mae|t[ -]?con))?|mainboard|fonte(?: de alimentacao)?|carcaca|base|suporte|cabo|adaptador|caixa(?: vazia)?|tela\s+(?:de\s+)?reposicao)\b/.test(title)
    || /\b(?:somente|apenas|vendo|venda de)\s+(?:a\s+|o\s+)?(?:placa|carcaca|base|tela|fonte|suporte)\b/.test(title)
    || /\b(?:para\s+(?:retirada\s+de\s+)?pecas|pecas\s+(?:para|de)|kit\s+(?:placa|pecas))\b/.test(title);
  const other = /\b(?:smart\s*tv|televisor)\b|^(?:console\s+)?(?:nintendo|switch|steam\s*deck|notebook|laptop)\b/.test(title);
  const offeredTitle=title.split(/\b(?:por|versus|vs|comparado)\b/)[0];
  const nonOled = (!oledModelIds(offeredTitle).length&&/\b(?:mini[ -]?led|qled)\b/.test(offeredTitle)
      && !/\boled\b.*\b(?:mini[ -]?led|qled)\b/.test(offeredTitle))
    || ['aw2725dm','aw2724dm','aw2720hf'].some(code=>codePattern(code).test(t))
    || /\b(?:painel|tecnologia|tela)\s*[:\-]?\s*(?:fast\s*)?(?:ips|va|tn|lcd)\b/.test(t);
  const defect = defectReason(text);
  if (part) reasons.push('Peça ou acessório, não monitor completo');
  if (other) reasons.push('Produto fora da categoria monitor de PC');
  if (nonOled) reasons.push('Modelo ou painel não OLED declarado');
  if (defect) reasons.push(defect);
  const plausible = models.length > 0 || (/\b(?:qd[ -]?)?oled\b/.test(t) && /\b(?:monitor|ultragear|odyssey|alienware)\b/.test(t));
  if (!plausible) reasons.push('Monitor OLED não identificado');
  if (!models.length && plausible) reasons.push('Modelo OLED ainda não confirmado no catálogo');
  if (models.length > 1) reasons.push('Mais de um modelo OLED informado; conferir identidade');
  if (!(Number(item?.price_brl) > 0)) reasons.push('Preço integral não confirmado');
  if (requireDetail && !item?.details_checked_at) reasons.push('Descrição e preço aguardam conferência');
  if (item?.identity_error) reasons.push(item.identity_error);
  if (item?.price_error) reasons.push(item.price_error);
  if (requireDetail && !String(item?.description_evidence ?? item?.description ?? '').trim()) reasons.push('Descrição do anúncio não localizada');
  const price = Number(item?.price_brl);
  if (price > 0 && [...text.matchAll(/(?:entrada|sinal|parcelas?\s*(?:de|por)?|\d{1,2}\s*x\s*(?:de)?)\s*[:\-]?\s*R\$\s*([\d.,]+)/gi)]
    .some(m => Math.abs(Number(m[1].replace(/\./g,'').replace(',','.')) - price) <= 1)) reasons.push('Preço pode ser entrada ou parcela');
  warnings.push('Ausência de defeito no texto não comprova estado físico ou ausência de burn-in');
  return { version: OLED_POLICY_VERSION, state: part || other || nonOled || defect || !plausible ? 'rejected' : reasons.length ? 'pending' : 'approved',
    model_ids: models, reasons, warnings };
}

export function isCompleteOledMonitor(item) {
  return assessOledMonitor(item, { requireDetail: false }).state !== 'rejected';
}
export function oledSearchMatchesTitle(title,query){
  if(!isCompleteOledMonitor({title}))return false;
  if(query==='monitor oled')return true;
  const requested=oledModelIds(query),found=oledModelIds(title);
  if(requested.length)return requested.some(id=>found.includes(id));
  const code=value=>normalizeMonitorText(value).replace(/[^a-z0-9]/g,'');
  return query==='monitor cepheus'?/\bcepheus\b/.test(normalizeMonitorText(title)):code(title).includes(code(query));
}
export function hasApprovedOledEvidence(item) {
  // Reassess older saved evidence with today's rules without turning an
  // unchanged approved offer into a new one when the policy version changes.
  return Boolean(item && item.status !== 'out_of_scope' && Number.isInteger(item.oled_validation?.version)
    && item.oled_validation.version>=1 && item.oled_validation.version<=OLED_POLICY_VERSION
    && Number(item.price_brl)>=OLED_PRICE.min && Number(item.price_brl)<=OLED_PRICE.max
    && item.oled_validation.state === 'approved' && assessOledMonitor(item).state === 'approved'
    && Number.isFinite(Date.parse(item.details_checked_at)));
}
export function isApprovedOledMonitor(item, { now = Date.now() } = {}) {
  const age=now-Date.parse(item?.details_checked_at ?? '');
  return hasApprovedOledEvidence(item) && age>=0 && age<OLED_DETAIL_TTL_MS;
}
export function classifySavedOledItem(item) {
  const validation = assessOledMonitor(item);
  return { ...item, oled_validation: validation, ...(validation.state === 'rejected' ? { status: 'out_of_scope' } : {}) };
}
export function oledPendingReason(item, { now = Date.now() } = {}) {
  if (!item || !['active', undefined].includes(item.status) || isOlxRecommendationUrl(item.url)
    || !Number.isFinite(Number(item.price_brl))
    || Number(item.price_brl) < OLED_PRICE.min || Number(item.price_brl) > OLED_PRICE.max) return null;
  const assessment = assessOledMonitor(item);
  if (assessment.state === 'rejected') return null;
  if (assessment.state === 'pending') return assessment.reasons.join('; ');
  if (!isApprovedOledMonitor(item, { now })) return 'Aguardando atualização: conferência vencida; preço e disponibilidade precisam ser confirmados novamente';
  return null;
}
export function filterOledReport(report, details = new Map()) {
  if (!report) return report;
  let section = '';
  const lines = report.split('\n').filter(line => {
    if (line.startsWith('## ')) section = line;
    if (!line.startsWith('- ')) return true;
    const url = line.match(/https?:\/\/\S+/)?.[0]?.replace(/[.,)]+$/, '');
    if (!url) return true;
    const item = details.get(url);
    return /pendentes|aguardando atualiza/i.test(section) ? Boolean(oledPendingReason(item)) : isApprovedOledMonitor(item);
  });
  const count = pattern => { let active=false, n=0; for (const line of lines) { if(line.startsWith('## ')) active=pattern.test(line); else if(active&&line.startsWith('- ')&&/https?:/.test(line))n++; } return n; };
  return lines.map(line => /^(?:- )?Novos produtos:/.test(line) ? line.replace(/\*\*\d+\*\*/,`**${count(/^## Novos produtos/)}**`)
    : /^(?:- )?Altera[cç][oõ]es de pre[cç]o:/.test(line) ? line.replace(/\*\*\d+\*\*/,`**${count(/^## Mudan[cç]as de pre[cç]o/)}**`) : line).join('\n');
}
