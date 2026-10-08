// A successful run must not clear failures in sources it did not query.
export function mergeCoverageStatus(previous = {}, snapshot = {}) {
  const run = snapshot.run ?? {};
  const states = { ...previous };
  for (const [key, value] of Object.entries(snapshot.coverage_status ?? {})) {
    if (!states[key] || Date.parse(value.checked_at) >= Date.parse(states[key].checked_at)) states[key] = value;
  }
  const at = run.completed_at ?? snapshot.generated_at ?? run.started_at;
  const scheduled = run.scheduled_coverage ?? run.scheduled_terms ?? [];
  const successful = new Set(run.successful_coverage ?? run.successful_terms ?? []);
  const failures = run.failed_coverage ?? run.failed_terms ?? [];
  const failed = new Set(failures.map((value) => typeof value === 'string' ? value : value.term));
  for (const key of scheduled) {
    if (!successful.has(key) && !failed.has(key)) continue;
    const old = states[key] ?? {};
    if (Date.parse(old.checked_at) > Date.parse(at)) continue;
    const separator = key.indexOf(':');
    const error = failures.find((value) => value?.term === key)?.error
      ?? (run.errors ?? []).find((value) => separator >= 0 && String(value).includes(key.slice(0, separator)) && String(value).includes(key.slice(separator + 1)))
      ?? 'Coleta incompleta';
    states[key] = {
      checked_at: at,
      last_success_at: successful.has(key) ? at : old.last_success_at ?? null,
      state: failed.has(key) ? 'failed' : 'success',
      error: failed.has(key) ? error : null,
    };
  }
  return states;
}
