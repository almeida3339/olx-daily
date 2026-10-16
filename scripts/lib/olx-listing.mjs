// Self-contained: evaluated in Playwright and raw CDP without module bindings.
export function readOlxListing() {
  const text = document.body?.innerText ?? '';
  const total = (text.match(/\d+\s*[-–]\s*\d+\s+de\s*([\d.]+)\s+(?:resultados?|an[uú]ncios?)/i)
    ?? text.match(/(?:^|\n)\s*([\d.]+)\s+resultados?/i))?.[1];
  const totalResults = total == null ? null : Number(total.replace(/\./g, ''));
  const cards = Array.from(document.querySelectorAll('section.olx-adcard'));
  let recommendations = 0;
  const items = [];
  for (const card of cards) {
    const a = card.querySelector('[data-testid=adcard-link]');
    if (!a?.href) continue;
    const url = new URL(a.href, location.href);
    // OLX recommendations use the same card component as search results.
    if ([...url.searchParams.keys()].some(key => key.startsWith('rec_detail_'))
      || url.searchParams.has('rec') || url.searchParams.get('is_fallback') === 'true') {
      recommendations++;
      continue;
    }
    items.push({ title: a.getAttribute('title') || a.textContent?.trim() || '', url: url.href,
      priceText: card.querySelector('h3.olx-adcard__price')?.textContent?.trim() || '',
      location: card.querySelector('.olx-adcard__location')?.textContent?.trim() || '', text: card.innerText || '' });
  }
  return { items: totalResults === 0 ? [] : items, totalResults, recommendations,
    hasNextPage: Boolean(document.querySelector('a[rel="next"]')) };
}

export function finishOlxListing(results, maxCards, payload = {}) {
  const cards = results.slice(0, maxCards);
  cards.total_results = payload.totalResults ?? null;
  cards.recommendations_ignored = payload.recommendations ?? 0;
  cards.listing_incomplete = results.length > maxCards || Boolean(payload.hasNextPage)
    || (Number.isFinite(payload.totalResults) && payload.totalResults > cards.length);
  return cards;
}

export function isOlxRecommendationUrl(value) {
  try {
    const url = new URL(value);
    return [...url.searchParams.keys()].some(key => key.startsWith('rec_detail_'))
      || url.searchParams.has('rec') || url.searchParams.get('is_fallback') === 'true';
  } catch { return false; }
}
