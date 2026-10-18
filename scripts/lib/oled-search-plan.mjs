import { OLED_SEARCH_TERMS } from './oled-monitor-scope.mjs';
import { olxIntervalHours } from './olx-traffic.mjs';

export const OLED_PRIORITY_TERMS = ['aw2726dm','aw2725d','aw2725df','odyssey oled g6','monitor cepheus','27gr95qe','27gs95qe'];
export function oledMlIntervalHours(term,state={},now=Date.now()) {
  const changed=state.last_valid_change_at&&now-Date.parse(state.last_valid_change_at)<7*86400_000;
  return changed||state.last_result_count>0?24:[...OLED_PRIORITY_TERMS,'monitor oled'].includes(term)?72:168;
}
export function oledQuerySpecs(source) {
  return OLED_SEARCH_TERMS.map(query => ({ id:query, query,
    priority: source === 'Enjoei' ? query === 'monitor oled' : [...OLED_PRIORITY_TERMS,'monitor oled'].includes(query),
    interval_hours: query === 'monitor oled' || OLED_PRIORITY_TERMS.includes(query) && source !== 'Enjoei' ? 12 : source === 'Enjoei' ? 168 : 72,
    max_age_hours: query === 'monitor oled' || OLED_PRIORITY_TERMS.includes(query) && source !== 'Enjoei' ? 24 : 168 }));
}
export function planOledQueries(source, coverage = {}, { now = Date.now(), fullSweep = false, explicit = null, traffic = null } = {}) {
  let specs=oledQuerySpecs(source);
  if(explicit?.length)return specs.filter(spec=>explicit.includes(spec.id));
  if(fullSweep)return specs;
  if(source==='OLX')specs=specs.filter(spec=>{
    const record=traffic?.queries?.[`oled-monitores:${spec.id}`];
    return !record?.last_attempt_at||now-Date.parse(record.last_attempt_at)>=olxIntervalHours('oled-monitores',spec.id,record)*3600_000;
  });
  const state=spec=>coverage[`${source}:${spec.id}`]??coverage[spec.id]??{};
  const secondary=specs.filter(spec=>!spec.priority && (source==='OLX' && traffic?.queries?.[`oled-monitores:${spec.id}`]?.last_attempt_at
    || !state(spec).last_success_at || state(spec).state==='failed'
    || now-Date.parse(state(spec).last_success_at)>=spec.interval_hours*3600_000))
    .sort((a,b)=>(Date.parse(state(a).checked_at)||0)-(Date.parse(state(b).checked_at)||0));
  const primary=specs.filter(spec=>spec.priority).sort((a,b)=>(Date.parse(state(a).checked_at)||0)-(Date.parse(state(b).checked_at)||0));
  return source==='ML' ? [...primary,...secondary] : [...primary,...secondary.slice(0,source==='Enjoei'?3:2)];
}
