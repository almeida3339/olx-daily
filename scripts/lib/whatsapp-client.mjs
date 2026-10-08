import { sanitizeErrorMessage } from './notification-status.mjs';

export async function sendWhatsApp(message, { fetchFn = fetch, env = process.env } = {}) {
  const phone = env.CALLMEBOT_PHONE?.trim().replace(/[\s()-]/g, '');
  const key = env.CALLMEBOT_APIKEY?.trim();
  if (!phone || !key) throw new Error('CALLMEBOT_PHONE/CALLMEBOT_APIKEY não definidas');
  if (!/^\+?\d{10,15}$/.test(phone)) throw new Error('Telefone do WhatsApp inválido; use código do país e DDD');
  const url = new URL('https://api.callmebot.com/whatsapp.php');
  url.searchParams.set('phone', phone);
  url.searchParams.set('text', String(message));
  url.searchParams.set('apikey', key);
  const response = await fetchFn(url, { signal: AbortSignal.timeout(30_000) });
  // The provider also returns errors with 201. An HTTP success alone does not
  // establish that a message was accepted.
  const body = await response.text();
  if (!response.ok || /\bERROR\s*:|invalid api.?key|apikey.*incorrect|not authorized/i.test(body)) {
    let detail = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    for (const secret of [phone, key, env.CALLMEBOT_PHONE]) if (secret) detail = detail.replaceAll(secret, '[redacted]');
    detail = sanitizeErrorMessage(detail).slice(0, 300);
    const guidance = response.status === 403 ? ' O provedor recusou a requisição. Confira a configuração local e a autorização do CallMeBot.' : '';
    throw new Error(`CallMeBot HTTP ${response.status}${detail ? `: ${detail}` : ''}.${guidance}`);
  }
}
