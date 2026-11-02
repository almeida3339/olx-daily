import { assertOlxAccessible } from './olx-notebook-quality.mjs';

export function olxDetailDiagnostic(detail, cardUrl) {
  const id = value => { try { return new URL(value).pathname.match(/\d{8,}$/)?.[0] ?? null; } catch { return null; } };
  const description = Boolean(detail.description?.trim());
  const price = detail.structured_price != null || Boolean(detail.price_text?.trim());
  const sameAd = cardUrl ? Boolean(id(cardUrl) && id(cardUrl) === id(detail.url)) : null;
  const unavailable = [404,410].includes(detail.http_status) || /^(?:an[uú]ncio (?:removido|indispon[ií]vel|expirado)|p[aá]gina n[aã]o encontrada)/i.test(detail.title?.trim() ?? '');
  return { state:unavailable ? 'unavailable' : sameAd === false ? 'wrong_ad' : description && price ? 'ready' : 'missing_ad_fields',
    http_status:detail.http_status ?? null, document_state:detail.document_state ?? null,
    description_found:description, price_found:price, structured_product_found:Boolean(detail.structured_product_found),
    description_source:detail.description_source ?? null, same_ad:sameAd,
    body_length:detail.body_length ?? detail.body_text?.length ?? 0,
    wait_ms:detail.wait_ms ?? 0, samples:detail.samples ?? 1 };
}

// Poll the same open document, never navigate again or consume another access.
// A large body can just be navigation/recommendations; require actual ad fields.
export async function readOlxDetailUntilReady(read, { timeoutMs=6000, intervalMs=500,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)), now=Date.now, cardUrl }={}) {
  const started=now(); let samples=0;
  while (true) {
    const detail=await read(); samples++;
    assertOlxAccessible(detail.body_text);
    if ([403,429].includes(detail.http_status)) {
      const error=Error(`OLX ficha HTTP ${detail.http_status}; coleta interrompida.`);
      error.pageState=detail.http_status===403 ? 'challenge' : 'limited'; throw error;
    }
    if (/\/(?:login|entrar)(?:\/|\?|$)/i.test(detail.url ?? '')) {
      const error=Error('OLX redirecionou para login'); error.pageState='logged_out'; throw error;
    }
    const diagnostic=olxDetailDiagnostic(detail,cardUrl);
    if (['ready','unavailable'].includes(diagnostic.state) || now()-started>=timeoutMs) {
      const result={...detail,wait_ms:now()-started,samples};
      result.diagnostic=olxDetailDiagnostic(result,cardUrl);
      if (result.diagnostic.state!=='ready') console.warn(`OLX ficha ${cardUrl?.match(/\d{8,}$/)?.[0] ?? ''}: ${JSON.stringify(result.diagnostic)}`);
      return result;
    }
    await sleep(Math.min(intervalMs,Math.max(0,timeoutMs-(now()-started))));
  }
}
