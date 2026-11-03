import { NOTEBOOK_PRIORITY_CPUS } from './notebook-policy.mjs';
import { olxIntervalHours } from './olx-traffic.mjs';

export const OLX_NOTEBOOK_FAMILIES = [
  ['helios-neo-16', 'helios neo 16'], ['rog-strix-g16', 'rog strix g16'],
  ['legion-pro-5', 'legion pro 5'], ['dell-g16', 'dell g16'],
  ['avell-a65', 'avell a65'], ['avell-storm', 'avell storm'],
].map(([id, query]) => ({ id: `family:${id}`, query }));

export const OLX_FAMILY_EXPERIMENT = [
  ['family:helios-neo-16', '14700hx'],
  ['family:rog-strix-g16', '13980hx'],
].map(([family, cpu]) => {
  const {query} = OLX_NOTEBOOK_FAMILIES.find(spec => spec.id === family);
  return { id: `${family}:${cpu}`, family, cpu, query: `${query} ${cpu}` };
});

export const OLX_FAMILY_SEARCHES = [...OLX_NOTEBOOK_FAMILIES, ...OLX_FAMILY_EXPERIMENT];

export function notebookQueryMaxAgeHours(key, source) {
  if (key.startsWith('family:')) return 72;
  return NOTEBOOK_PRIORITY_CPUS.includes(key) ? 24 : source === 'mercadolivre-notebooks' ? 168 : 48;
}

export function planNotebookFamilies(previous, { now = Date.now(), budget = 1, fullSweep = false, traffic = null } = {}) {
  const attempts = id => {
    const record = traffic?.queries?.[`notebooks:${id}`];
    return {record, at: Date.parse(record?.last_attempt_at ?? previous?.coverage_status?.[id]?.checked_at) || 0};
  };
  const lastFamilyAttempt = id => {
    const broad = attempts(id);
    const variant = OLX_FAMILY_EXPERIMENT.find(spec => spec.family === id);
    const specific = variant ? attempts(variant.id) : {at: 0};
    return specific.at > broad.at ? specific : broad;
  };
  const due = OLX_NOTEBOOK_FAMILIES.filter(({ id }) => {
    if (fullSweep) return true;
    const {record, at} = lastFamilyAttempt(id);
    if (record?.last_attempt_at) return now - at >= olxIntervalHours('notebooks', id, record) * 3600_000;
    return !previous?.coverage_status?.[id]?.last_success_at
      || now - Date.parse(previous.coverage_status[id].last_success_at) >= 24 * 3600_000;
  });
  // A partial query still consumed its slot. Rotate by attempt time so an
  // incomplete family cannot starve families that have never been queried.
  return due.sort((a,b) => lastFamilyAttempt(a.id).at - lastFamilyAttempt(b.id).at)
    .slice(0, fullSweep ? Infinity : budget).map(({id}) => {
      const variant = OLX_FAMILY_EXPERIMENT.find(spec => spec.family === id);
      if (fullSweep || !variant) return id;
      const broad = attempts(id).at;
      return broad > attempts(variant.id).at ? variant.id : id;
    });
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
