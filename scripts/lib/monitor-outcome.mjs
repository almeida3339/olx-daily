import { classifyMonitorError } from './monitor-errors.mjs';

export const MONITOR_EXIT_CODES = { success: 0, partial: 2, deferred: 3, blocked: 4, failed: 1 };
const expected = /listagem incompleta|limite de cards|fichas?\(s\).*aguardando|fichas?.*pendente|cobertura pendente|cobertura incompleta|or[cç]amento|prazo.*(?:atingido|esgotado)|paginas? pendentes|páginas? pendentes|consultas? adiad|pausa ap[oó]s bloqueio|em pausa at[eé]|limite de p[aá]ginas|page budget|deadline/i;
export function classifyMonitorOutcome(run = {}, { quarantined = 0 } = {}) {
  const entries = [...(run.errors ?? []), ...(run.failed_terms ?? [])];
  const issues = entries.map(entry => ({ kind: entry?.kind, message: String(entry?.error ?? entry ?? '') }));
  const deferred = (run.deferred_coverage ?? run.deferred_terms ?? []).length;
  const real = issues.filter(issue => issue.kind !== 'deferred' && !/consultas? adiad|em pausa at[eé]|pausa ap[oó]s bloqueio/i.test(issue.message));
  const blocked = real.some(issue => ['challenge','authentication','rate_limited'].includes(issue.kind ?? classifyMonitorError(issue.message).kind));
  const failed = quarantined > 0 || (run.failed_term_count > 0 && !issues.length)
    || real.some(issue => !['incomplete','deferred'].includes(issue.kind) && !expected.test(issue.message));
  const status = blocked ? 'blocked' : failed || (run.aborted && !blocked) ? 'failed'
    : deferred && !(run.scheduled_coverage ?? run.scheduled_terms ?? []).length ? 'deferred'
      : run.partial || deferred || real.length ? 'partial' : 'success';
  return { status, exit_code: MONITOR_EXIT_CODES[status],
    reasons: [...new Set(issues.map(issue => issue.message).filter(Boolean))],
    completed_terms: (run.successful_coverage ?? run.successful_terms ?? []).length,
    incomplete_terms: (run.failed_coverage ?? run.failed_terms ?? []).length, deferred_terms: deferred };
}

export function setMonitorExit(run) {
  const outcome = run.operational ?? classifyMonitorOutcome(run);
  const rank = { 0:0, 3:1, 2:2, 4:3, 1:4 };
  if ((rank[outcome.exit_code] ?? 4) > (rank[process.exitCode ?? 0] ?? 4)) process.exitCode = outcome.exit_code;
  return outcome;
}
