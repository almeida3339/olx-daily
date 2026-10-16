import { NOTEBOOK_PRIORITY_CPUS } from './notebook-policy.mjs';

export const OLX_NOTEBOOK_FAMILIES = [
  ['helios-neo-16', 'helios neo 16'], ['rog-strix-g16', 'rog strix g16'],
  ['legion-pro-5', 'legion pro 5'], ['dell-g16', 'dell g16'],
  ['avell-a65', 'avell a65'], ['avell-storm', 'avell storm'],
].map(([id, query]) => ({ id: `family:${id}`, query }));

export function notebookQueryMaxAgeHours(key, source) {
  if (key.startsWith('family:')) return 72;
  return NOTEBOOK_PRIORITY_CPUS.includes(key) ? 24 : source === 'mercadolivre-notebooks' ? 168 : 48;
}

export function planNotebookFamilies(previous, { now = Date.now(), budget = 2, fullSweep = false } = {}) {
  const due = OLX_NOTEBOOK_FAMILIES.filter(({ id }) => fullSweep
    || !previous?.coverage_status?.[id]?.last_success_at
    || now - Date.parse(previous.coverage_status[id].last_success_at) >= 24 * 3600_000);
  // A partial query still consumed its slot. Rotate by attempt time so an
  // incomplete family cannot starve families that have never been queried.
  return due.sort((a,b) => (Date.parse(previous?.coverage_status?.[a.id]?.checked_at) || 0)
    - (Date.parse(previous?.coverage_status?.[b.id]?.checked_at) || 0)).slice(0, fullSweep ? Infinity : budget).map(spec => spec.id);
}

export function notebookOpportunity(item, pool = []) {
  const family = (item.title ?? '').toLowerCase().match(/helios\s+neo\s*16|rog\s+strix\s*g\d+|legion\s+pro\s*\d+|avell\s+a\d+|msi\s+raider\s*\w+/)?.[0]?.replace(/\s+/g,' ');
  const cpu = item.cpu_term ?? item.cpu_terms?.[0] ?? item.terms?.[0];
  const peers = family && item.gpu && item.ram_gb ? [...new Map(pool.filter(other => other.id !== item.id
    && other.status === 'active' && other.validation?.state === 'validated'
    && (other.title ?? '').toLowerCase().replace(/\s+/g,' ').includes(family)
    && (other.cpu_term ?? other.cpu_terms?.[0] ?? other.terms?.[0]) === cpu
    && other.gpu === item.gpu && other.ram_gb === item.ram_gb
    && other.condition && item.condition && other.condition === item.condition
    && Number(other.price_brl) >= 2000 && Number(other.price_brl) <= 10000
    && Date.now() - Date.parse(other.validation?.checked_at ?? '') < 45 * 86400_000).map(other => [other.id, other])).values()] : [];
  if (peers.length < 3) return { state: 'insufficient_comparables', sample: peers.length,
    reason: 'Sem três anúncios independentes recentes com família, CPU, GPU, RAM e condição semelhantes' };
  const prices = peers.map(peer => Number(peer.price_brl)).sort((a,b) => a-b);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[mid] : (prices[mid-1] + prices[mid]) / 2;
  return { state: 'indicative', sample: peers.length, median_brl: median,
    difference_percent: Math.round(1000 * (median - item.price_brl) / median) / 10,
    reason: 'Referência indicativa de preços anunciados; frete, TGP e condição física não foram confirmados' };
}
