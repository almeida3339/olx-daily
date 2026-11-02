// Keep the learned floor after a successful collection; completeness is not a
// reason to forget that this query needs more than the default twelve cards.
export function olxNotebookListingLimit(term, base, previous = {}, saved = {}) {
  const family = term.startsWith('family:');
  const cap = family ? 90 : 60;
  const limits = [base, previous.listing_limit, saved.listing_limit]
    .map(Number).filter(value => Number.isFinite(value) && value > 0);
  const prior = Math.min(cap, Math.max(...limits, family ? 60 : term === '14900hx' ? 36 : base));
  const truncated = previous.listing_incomplete ?? saved.listing_incomplete ?? false;
  return Math.min(cap, prior + (truncated ? family ? 30 : 24 : 0));
}
