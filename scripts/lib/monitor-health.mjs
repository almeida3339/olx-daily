import path from "node:path";
import { classifyMonitorError } from "./monitor-errors.mjs";
import { MONITOR_LABELS } from "./monitor-labels.mjs";
import { readMonitorHistory, summarizeMonitorHistory } from "./monitor-history.mjs";
import { listCommittedRuns, readJsonValidated, readLatestValidSnapshot, timestampFromArtifactName } from "./monitor-runtime.mjs";
import { mergeCoverageStatus } from "./monitor-coverage.mjs";
import { watchlistHealthDefinitions } from "./watchlists-registry.mjs";
import { DEFAULT_CPU_TERMS } from './cpu-terms.mjs';
import { notebookQueryMaxAgeHours } from './notebook-search-plan.mjs';
import { oledQuerySpecs, oledMlIntervalHours } from './oled-search-plan.mjs';
import { classifyMonitorOutcome } from './monitor-outcome.mjs';

const monitorHealthSourceDefinitions = watchlistHealthDefinitions();

export const monitorHealthSources = monitorHealthSourceDefinitions.map(([id, label, maxAgeMs]) => [id, MONITOR_LABELS[id] ?? label, maxAgeMs]);

export async function buildMonitorHealth(root, { now = new Date() } = {}) {
  const sources = [];
  const mlSchedule = await readJsonValidated(path.join(root, 'data', 'status', 'mercadolivre-schedule.json')).catch(() => null);
  const traffic = await readJsonValidated(path.join(root,'data/status/olx-traffic.json')).catch(()=>null);
  const mlBlocked = mlSchedule?.global?.requires_login || Date.parse(mlSchedule?.global?.blocked_until ?? '') > now.getTime();
  for (const [id, label, configuredMaxAgeMs] of monitorHealthSources) {
    const maxAgeMs=id==='mercadolivre-oled-monitores'?168*3600_000:configuredMaxAgeMs;
    const dataDir = path.join(root, "data", id);
    const result = await readLatestValidSnapshot(dataDir);
    const snapshot = result.snapshot;
    const history = await readMonitorHistory(dataDir);
    const historySummary = summarizeMonitorHistory(history);
    const artifacts = await listCommittedRuns(dataDir, { limit: 120 });
    let coverage = {};
    for (const artifact of artifacts.reverse()) coverage = mergeCoverageStatus(coverage, artifact.snapshot);
    coverage = mergeCoverageStatus(coverage, snapshot ?? {});
    const configuredRaw = snapshot?.run?.configured_coverage ?? snapshot?.run?.configured_terms ?? [];
    const configured = ['olx','enjoei-notebooks','mercadolivre-notebooks'].includes(id)
      ? configuredRaw.filter(key => key.startsWith('family:') || DEFAULT_CPU_TERMS.includes(key)) : configuredRaw;
    const ageByKey={};
    for(const key of configured){
      const term=id==='olx'?key:key.startsWith('OLX:')?key.slice(4):null;
      if(!term)continue;
      const watchlist=id==='olx'?'notebooks':id;
      const records=Object.entries(traffic?.queries??{}).filter(([query])=>query===`${watchlist}:${term}`||query.startsWith(`${watchlist}:${term}@`)).map(([,record])=>record);
      if(records.length)ageByKey[key]=Math.max(maxAgeMs,id==='olx'?notebookQueryMaxAgeHours(key,id)*3600_000:0,...records.map(record=>((record.interval_hours??24)+12)*3600_000));
    }
    if(['oled-monitores','mercadolivre-oled-monitores'].includes(id))for(const key of configured){
      const source=id.startsWith('mercadolivre-')?'ML':key.split(':')[0];
      const term=source==='ML'?key:key.slice(key.indexOf(':')+1);
      const spec=oledQuerySpecs(source).find(s=>s.id===term);
      if(spec)ageByKey[key]=Math.max(ageByKey[key]??0,(source==='ML'?oledMlIntervalHours(term,mlSchedule?.watchlists?.['oled-monitores']?.terms?.[term],now.getTime()):spec.max_age_hours)*3600_000);
    }
    const marketplaces = id === 'enjoei' && snapshot?.run?.search_schedule
      ? shoeScheduleHealth(snapshot.run.search_schedule, now)
      : coverageHealth(configured, coverage, { now, maxAgeMs, id, sourceBlocks: snapshot?.source_blocks ?? {},ageByKey });
    const timestamp = snapshotTimestamp(snapshot, result.file);
    const ageMs = timestamp == null ? null : Math.max(0, now.getTime() - timestamp);
    const errors = asArray(snapshot?.run?.errors ?? snapshot?.run?.failed_terms);
    const classifications = errors.map((error) => classifyMonitorError(typeof error === "string" ? error : error?.error));
    const outcome=snapshot?(['failed','blocked'].includes(snapshot.run?.operational?.status)
      ?snapshot.run.operational:classifyMonitorOutcome(snapshot.run)):null;
    let state = "healthy";
    if (!snapshot) state = "missing";
    else if (snapshot.run?.operational?.status === 'failed') state = 'failed';
    else if (classifications.some((item) => ["challenge", "authentication", "rate_limited"].includes(item.kind))) state = "blocked";
    else if (ageMs != null && ageMs > maxAgeMs) state = "stale";
    else if (snapshot.run?.partial && outcome?.status!=='deferred') state = "partial";
    else if (historySummary.sample >= 3 && (historySummary.failed + historySummary.blocked) >= Math.ceil(historySummary.sample / 2)) state = "degraded";
    if (marketplaces.length && snapshot) state = worstState([state, ...marketplaces.map((source) => source.state)]);
    if (snapshot?.run?.in_progress && state === 'healthy') state = 'partial';
    const profileBlocked = id.startsWith('mercadolivre-') && mlBlocked;
    if (profileBlocked) state = 'blocked';
    const hardDenial = Object.entries(snapshot?.source_blocks ?? {}).find(([source, block]) => source === 'OLX' && block.recovery_kind === 'hard_denial');
    const olxPause = snapshot?.source_blocks?.OLX;
    const pauseNote = Date.parse(olxPause?.blocked_until ?? '') > now
      ? `OLX em pausa após bloqueio até ${new Date(olxPause.blocked_until).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} BRT; consultas adiadas. ` : '';
    const freshnessNote = id.startsWith('mercadolivre-')
      ? `Sob demanda · ${ageMs == null ? 'sem coleta registrada' : `última coleta há ${formatHealthAge(ageMs)}`} · ` : '';
    sources.push({
      id,
      label,
      state,
      operational_status: outcome?.status ?? null,
      updated_at: timestamp == null ? null : new Date(timestamp).toISOString(),
      age_ms: ageMs,
      invalid_snapshots: result.invalid.length,
      history: historySummary,
      marketplaces,
      message: freshnessNote + pauseNote + (hardDenial ? `OLX recusou o acesso; sem CAPTCHA disponível. ${hardDenial[1].reason ?? ''}` : profileBlocked ? `Perfil ML exige login/verificação${mlSchedule.global.blocked_until ? `; pausa até ${new Date(mlSchedule.global.blocked_until).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : ''}`
        : state === 'failed' ? healthMessage(state)
        : snapshot?.run?.in_progress ? 'Coleta em andamento; progresso salvo'
        : snapshot?.run?.aborted ? 'Coleta interrompida; resultados parciais preservados' : marketplaces.length
        ? marketplaces.map((source) => `${source.label}: ${healthMessage(source.state)} (${source.fresh_terms}/${source.total_terms} termos recentes${source.warming_terms ? `; ${source.warming_terms} em implantação` : ''})`).join(' · ')
        : healthMessage(state)),
    });
  }
  const statusDir = path.join(root, "data", "status");
  const statuses = await Promise.all(["latest-local.json", "latest-ci.json"].map(async (file) => readJsonValidated(path.join(statusDir, file)).catch(() => null)));
  const outbox = dedupeNotificationOutbox(statuses);
  const blocked = outbox.filter((item) => item.status === "blocked").length;
  const retrying = outbox.filter((item) => ["pending", "retry_wait", "sending"].includes(item.status)).length;
  sources.push({
    id: "notifications",
    label: "Notificações",
    state: blocked ? "blocked" : retrying ? "partial" : "healthy",
    updated_at: null,
    age_ms: null,
    invalid_snapshots: 0,
    message: blocked ? `${blocked} entrega(s) bloqueada(s)` : retrying ? `${retrying} entrega(s) aguardando nova tentativa` : "Fila de entrega saudável",
    outbox: outbox.filter((item) => item.status !== "sent").map((item) => ({
      id: item.id,
      channel: item.channel,
      status: item.status,
      attempts: item.attempts,
      next_attempt_at: item.next_attempt_at,
      last_error: item.last_error,
    })),
  });
  return { schema_version: 2, generated_at: now.toISOString(), sources, olx_traffic: traffic };
}

function worstState(states) {
  return ['failed', 'blocked', 'missing', 'stale', 'partial', 'degraded', 'healthy'].find((state) => states.includes(state)) ?? 'healthy';
}

// Separar coleta atrasada de publicação recente: o Windows pode publicar OLX
// normalmente enquanto o job remoto do Enjoei deixou de executar há dias.
export function collectionHealthAlerts(health) {
  const sources = health?.sources ?? [];
  const alerts = [];
  const enjoei = sources.filter(source => source.id === 'enjoei' || source.id.startsWith('enjoei-'));
  const staleEnjoei = enjoei.filter(source => ['missing', 'failed', 'stale'].includes(source.state)
    && (source.age_ms == null || source.age_ms > 36 * 3600_000 || source.state === 'failed'));
  if (staleEnjoei.length) alerts.push({ id: 'enjoei', automatic: true,
    message: `Enjoei: ${staleEnjoei.length} busca(s) sem coleta recente ou com falha. A publicação de outras fontes não atualiza essas buscas; recuperação local disponível.` });
  const notebooks = sources.find(source => source.id === 'olx');
  if (notebooks && ['missing', 'stale', 'failed'].includes(notebooks.state)) alerts.push({ id: 'olx', automatic: true,
    message: 'OLX Notebooks: coleta ausente, desatualizada ou com falha; ausência de alertas não significa ausência de ofertas.' });
  const oled = sources.find(source => source.id === 'oled-monitores');
  if (oled?.state === 'blocked') alerts.push({ id: 'oled', automatic: false,
    message: `Monitores OLED: cobertura da OLX bloqueada. ${oled.message}` });
  const staleMl = sources.filter(source => source.id.startsWith('mercadolivre-')
    && (source.age_ms == null || source.age_ms > 7 * 86400_000));
  if (staleMl.length) alerts.push({ id: 'mercadolivre', automatic: false,
    message: `Mercado Livre: ${staleMl.length} busca(s) sem coleta há mais de sete dias. Use o disparo sob demanda para atualizar.` });
  return alerts;
}

function shoeScheduleHealth(schedule, now) {
  const labels = { priority: 'Enjoei prioritárias', daily: 'Enjoei diárias', rotation: 'Enjoei rodízio', discovery: 'Enjoei descoberta semanal' };
  return Object.entries(labels).flatMap(([tier, label]) => {
    const queries = Object.values(schedule).filter(query => query.tier === tier);
    if (!queries.length) return [];
    const states = queries.map(query => {
      if (query.state === 'failed') return ['challenge', 'authentication', 'rate_limited'].includes(classifyMonitorError(query.error).kind) ? 'blocked' : 'partial';
      if (!query.last_success_at) return 'partial';
      if (now.getTime() - Date.parse(query.last_success_at) > query.max_age_hours * 3600_000) return 'stale';
      return 'healthy';
    });
    return [{ label, state: worstState(states), total_terms: queries.length,
      fresh_terms: states.filter(state => state === 'healthy').length,
      warming_terms: queries.filter(query => !query.last_success_at).length,
      updated_at: queries.map(query => query.last_success_at).filter(Boolean).sort().at(-1) ?? null }];
  });
}

function coverageHealth(configured, coverage, { now, maxAgeMs, id, sourceBlocks,ageByKey={} }) {
  const groups = new Map();
  for (const key of configured) {
    const label = key.startsWith('family:') ? 'OLX modelos' : key.includes(':') ? key.split(':')[0] : id.startsWith('mercadolivre-') ? 'ML' : id === 'olx' ? 'OLX' : 'Enjoei';
    const terms = groups.get(label) ?? [];
    terms.push({ ...(coverage[key] ?? {}), max_age_ms: ageByKey[key]??(['olx','enjoei-notebooks','mercadolivre-notebooks'].includes(id) ? notebookQueryMaxAgeHours(key, id) * 3600_000 : maxAgeMs) });
    groups.set(label, terms);
  }
  return [...groups].map(([label, terms]) => {
    const states = terms.map((term) => {
      if (!term.checked_at) return 'partial';
      if (term.state === 'failed' && ['challenge', 'authentication', 'rate_limited'].includes(classifyMonitorError(term.error).kind)) return 'blocked';
      if (now.getTime() - Date.parse(term.checked_at) > term.max_age_ms) return 'stale';
      return term.state === 'failed' ? 'partial' : 'healthy';
    });
    const blocked = Date.parse(sourceBlocks[label]?.blocked_until ?? '') > now.getTime();
    return { label, state: blocked ? 'blocked' : worstState(states), total_terms: terms.length, fresh_terms: states.filter((state) => state === 'healthy').length,
      warming_terms:terms.filter(term=>!term.checked_at).length,
      updated_at: terms.map((term) => term.checked_at).filter(Boolean).sort().at(-1) ?? null };
  });
}

// Local e CI podem carregar o mesmo item persistido no outbox. O ID é a chave
// de identidade; em caso de divergência, vence o estado mais recente (ou
// bloqueado, para não esconder uma falha que exige ação).
function dedupeNotificationOutbox(statuses) {
  const byId = new Map();
  const delivered = new Set(statuses.flatMap((status) => status?.notification_sent_ids ?? []));
  const archived = new Map(statuses.flatMap((status) => status?.notification_archive ?? []).map((item) => [item.id, item.archived_at]));
  for (const status of statuses) {
    for (const item of asArray(status?.notification_outbox)) {
      if (delivered.has(item.id)) continue;
      if (archived.has(item.id) && Date.parse(archived.get(item.id)) >= Date.parse(item.updated_at ?? item.created_at ?? 0)) continue;
      const key = item?.id ?? `${item?.channel ?? "?"}:${item?.dedupe_key ?? item?.last_error ?? "?"}`;
      const previous = byId.get(key);
      if (!previous || compareNotificationItems(item, previous) > 0) byId.set(key, item);
    }
  }
  return [...byId.values()];
}

function compareNotificationItems(left, right) {
  const leftTs = Date.parse(left?.updated_at ?? left?.created_at ?? "");
  const rightTs = Date.parse(right?.updated_at ?? right?.created_at ?? "");
  if (Number.isFinite(leftTs) && Number.isFinite(rightTs) && leftTs !== rightTs) return leftTs - rightTs;
  if (left?.status === "blocked" && right?.status !== "blocked") return 1;
  if (right?.status === "blocked" && left?.status !== "blocked") return -1;
  return 0;
}

function healthMessage(state) {
  if (state === "failed") return "Falha técnica na coleta";
  if (state === "partial") return "Cobertura parcial";
  if (state === "stale") return "Coleta desatualizada";
  if (state === "blocked") return "Login, limite ou desafio exigem atenção";
  if (state === "missing") return "Sem snapshot válido";
  if (state === "degraded") return "Falhas ou cobertura parcial recorrentes";
  return "Saudável";
}

function snapshotTimestamp(snapshot, file) {
  const candidates = [snapshot?.run?.completed_at, snapshot?.run?.started_at, snapshot?.generated_at];
  for (const value of candidates) {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) return timestamp;
  }
  return timestampFromArtifactName(file);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatHealthAge(ageMs) {
  if (ageMs < 3600_000) return `${Math.floor(ageMs / 60_000)} min`;
  if (ageMs < 86400_000) return `${Math.floor(ageMs / 3600_000)} h`;
  return `${Math.floor(ageMs / 86400_000)} dia(s)`;
}
