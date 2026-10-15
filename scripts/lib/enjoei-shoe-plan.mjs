// Stable query IDs keep cursors and freshness independent of list ordering.
const query = (term, tier, hours) => ({ id: term, term, tier, interval_hours: hours });
export const ENJOEI_SHOE_PLAN = [
  ...['fiber', 'feet of tomorrow', 'fot walka', 'barefoot']
    .map(term => query(term, 'priority', 0)),
  ...['lems', 'vita barefoot'].map(term => query(term, 'daily', 24)),
  ...['vivobarefoot', 'vivo barefoot', 'xero', 'vibram fivefingers', 'fivefingers', 'five fingers',
    'vapor glove', 'trail glove', 'merrell', 'saguaro', 'whitin', 'hobibear', 'groundies', 'be lenka',
    'zero drop', 'drop zero'].map(term => query(term, 'rotation', 72)),
  // These model aliases also attract many fuzzy results. Deep discovery gets
  // its own budget; the brand and barefoot searches run on every invocation.
  ...['fot lito', 'fot noga', 'fot voet', 'fot bruk', 'fot', 'freet', 'minimalista', 'minimalistas'].map(term => query(term, 'discovery', 168)),
  ...['fiber', 'feet of tomorrow'].map(term => ({ ...query(term, 'discovery', 168), id: `${term} (unissex)`, department: null })),
];

export function shoeCoverageMaxAgeHours(tier) {
  return ({ priority: 24, daily: 48, rotation: 96, discovery: 336 })[tier] ?? 24;
}

export function shoeQuerySchedule(spec, cursor, introducedAt, now = Date.now()) {
  const completed = Date.parse(cursor?.completed_at ?? '');
  const started = Date.parse(introducedAt);
  const age = now - (Number.isFinite(completed) ? completed : started);
  return { ...spec, last_attempt_at: cursor?.last_attempt_at ?? null,
    last_success_at: cursor?.completed_at ?? null,
    next_due_at: Number.isFinite(completed) ? new Date(completed + spec.interval_hours * 3600_000).toISOString() : null,
    max_age_hours: shoeCoverageMaxAgeHours(spec.tier),
    state: cursor?.request_error ? 'failed' : age > shoeCoverageMaxAgeHours(spec.tier) * 3600_000 ? 'stale'
      : !Number.isFinite(completed) ? 'warming' : 'healthy',
    pending: Boolean(cursor && !cursor.complete), error: cursor?.request_error ?? null };
}
