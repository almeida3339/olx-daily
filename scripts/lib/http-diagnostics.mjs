import {createHash} from 'node:crypto';

async function boundedBody(response,limit=4096) {
  const reader=response.body?.getReader?.();
  if (!reader) return ''; // Never read an unbounded text()/json() error body.
  let timer,bytes=0; const chunks=[];
  try {
    timer=setTimeout(()=>{reader.cancel().catch(()=>{});},1500);
    while (bytes<limit) {
      const {value,done}=await reader.read(); if (done) break;
      const chunk=value.subarray(0,limit-bytes); chunks.push(Buffer.from(chunk)); bytes+=chunk.length;
    }
  } catch { /* Metadata still diagnoses responses with an unreadable body. */ }
  finally { clearTimeout(timer); reader.cancel().catch(()=>{}); }
  return Buffer.concat(chunks).toString('utf8');
}

// Error bodies may echo request values or personal data. Publish structural
// evidence and recognized error categories, never raw body/header dumps.
export async function httpResponseError(response, {label='HTTP'}={}) {
  const body=await boundedBody(response);
  const contentType=response.headers?.get?.('content-type')?.split(';')[0]?.trim() ?? '';
  let payload; try {payload=JSON.parse(body);} catch {}
  const entries=[payload,payload?.error,...(Array.isArray(payload?.errors)?payload.errors:[])].filter(x=>x&&typeof x==='object');
  const codes=[...new Set(entries.flatMap(e=>[e.code,e.type,e.extensions?.code]).filter(v=>typeof v==='string'&&/^[A-Z][A-Z_\d.-]{1,63}$/.test(v)))].slice(0,5);
  const text=entries.map(e=>typeof e.message==='string'?e.message:'').join(' ') || body;
  const category=/captcha|cloudflare|verify.*human|access denied/i.test(text)?'verification_required'
    : /(?:invalid|expired|inv[aá]lido).*cursor|cursor.*(?:invalid|expired|inv[aá]lido)/i.test(text)?'invalid_cursor'
    : /(?:invalid|missing|required|inv[aá]lido|obrigat[oó]rio).*(?:parameter|argument|field|par[aâ]metro|campo)/i.test(text)?'invalid_parameter'
    : /rate.limit|too many requests/i.test(text)?'rate_limit'
    : /temporar|unavailable|indispon[ií]vel/i.test(text)?'temporarily_unavailable':'unknown';
  const knownFields=['term','after','first','query_id','operation_name','shipping_range','search_id','browser_id','size_types','recommendation_context'];
  const fields=knownFields.filter(field=>new RegExp(`\\b${field}\\b`,'i').test(text));
  const requestId=response.headers?.get?.('x-request-id') ?? response.headers?.get?.('cf-ray');
  const diagnostic={status:Number(response.status),content_type:/^[\w.+-]+\/[\w.+-]+$/.test(contentType)?contentType:'unknown',
    response_kind:payload?'json':/^\s*(?:<!doctype|<html)/i.test(body)?'html':body?'text':'empty_or_unreadable',category,codes,fields,
    body_fingerprint:body?createHash('sha256').update(body).digest('hex').slice(0,16):null,
    request_id:typeof requestId==='string'&&/^[a-z\d_-]{1,100}$/i.test(requestId)?requestId:null};
  const error=Error(`${label} ${response.status} — diagnóstico ${JSON.stringify(diagnostic)}`);
  error.http_diagnostic=diagnostic;
  return error;
}
