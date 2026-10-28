import { createHash } from 'node:crypto';

export function safeMercadoLivreNextUrl(href, current) {
  if (!href) return null;
  try {
    const url = new URL(href, current);
    if (url.protocol !== 'https:' || !['lista.mercadolivre.com.br','www.mercadolivre.com.br'].includes(url.hostname)) return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

// Each call has a finite page/candidate budget; an access challenge always escapes.
export async function collectMercadoLivrePages({ initialUrl, fetchPage, matches, accepts, inPriceRange = () => true,
  maxPages = 3, maxItems = 20, deadline = Infinity }) {
  const items = new Map(), signatures = new Set(), visited = new Set();
  let url = initialUrl, pages = 0, rawCount = 0, scopeRejected = 0, outsidePrice = 0;
  const result = (complete, reason = null, nextUrl = null, exhaustive = complete) => ({
    items: [...items.values()], complete, reason, next_url: typeof nextUrl === 'string' ? nextUrl : null,
    next_action: nextUrl?.click_next ? 'click_next' : null, pages,
    exhaustive, stop_reason: reason, raw: rawCount, scope_rejected: scopeRejected, outside_price: outsidePrice,
  });
  while (url && pages < maxPages && Date.now() < deadline) {
    const visitKey = typeof url === 'string' ? url : JSON.stringify(url);
    if (visited.has(visitKey)) return result(false, 'repeated_page', url);
    visited.add(visitKey);
    let page;
    try { page = await fetchPage(url, pages); }
    catch (error) { error.partialItems = [...items.values()]; error.pagesFetched = pages; throw error; }
    pages++;
    if (page.empty) return result(true);
    const raw = page.items;
    if (!Array.isArray(raw) || !raw.length) {
      const error = new Error('Nenhum card reconhecido; possível mudança de layout.');
      error.partialItems = [...items.values()]; error.pagesFetched = pages; throw error;
    }
    const signature = createHash('sha256').update(JSON.stringify(raw.map(item => item.id ?? item.url))).digest('hex');
    if (signatures.has(signature)) return result(false, 'repeated_page', url);
    signatures.add(signature);
    rawCount += raw.length;
    outsidePrice += raw.filter(item => !inPriceRange(item)).length;
    const relevant = raw.filter(matches);
    scopeRejected += raw.length - relevant.length;
    if (pages === 1 && !relevant.length) return result(true, 'first_page_no_match', null, false);
    const accepted = relevant.filter(accepts);
    let overflow = false;
    for (const item of accepted) {
      const key = item.id ?? item.url;
      if (!items.has(key) && items.size >= maxItems) { overflow = true; break; }
      items.set(key, { ...item, observed_at: new Date().toISOString() });
    }
    const next = page.nextAction && !page.nextUrl ? { click_next: true, from: page.nextAction.from }
      : safeMercadoLivreNextUrl(page.nextUrl, typeof url === 'string' ? url : url.from);
    if (overflow) return result(false, 'candidate_budget', next);
    if (!next && page.hasNext) return result(false, 'unrecognized_next_page');
    if (!next) return result(true);
    if (Date.now() >= deadline) return result(false, 'time_budget', next);
    url = next;
  }
  return result(false, Date.now() >= deadline ? 'time_budget' : 'page_budget', url);
}
