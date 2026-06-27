import crypto from "node:crypto";

// Estado de entrega das notificações (e-mail/WhatsApp), persistido entre rodadas
// para que uma rodada seguinte bem-sucedida possa mencionar a falha da anterior.
// Tudo aqui é função PURA (sem rede/I/O) para ser testável.

// Remove segredos (telefone, apikey, token, etc.) e querystrings de URLs de mensagens de erro
// antes de gravá-las em disco (o repositório é público).
export function sanitizeErrorMessage(message) {
  let out = String(message ?? "").trim();

  // 1. Redige Bearer token credentials
  out = out.replace(/bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi, "Bearer [redacted]");

  // 2. Redige querystring inteira de qualquer URL (tudo após ?)
  out = out.replace(/(https?:\/\/[^\s"'?]+)\?[^\s"']*/gi, "$1?[redacted]");

  // 3. Redige chaves sensíveis: apikey, api_key, token, password, secret, authorization, phone
  const keysToRedact = ["apikey", "api_key", "token", "password", "secret", "authorization", "phone"];
  for (const key of keysToRedact) {
    // 3a. Authorization com Bearer/Basic: "Authorization: Basic abcdef"
    const reAuth = new RegExp(`(${key})\\s*[:=]\\s*(bearer|basic)\\s+[^\\s&,;"]+`, "gi");
    out = out.replace(reAuth, "$1=[redacted]");

    // 3b. Valores entre aspas duplas: password: "valor com espaços"
    const reDoubleQuote = new RegExp(`(${key})\\s*[:=]\\s*"[^"]*"`, "gi");
    out = out.replace(reDoubleQuote, "$1=[redacted]");

    // 3c. Valores entre aspas simples: token='segredo'
    const reSingleQuote = new RegExp(`(${key})\\s*[:=]\\s*'[^']*'`, "gi");
    out = out.replace(reSingleQuote, "$1=[redacted]");

    // 3d. Valores comuns sem aspas: api_key: secret123
    const reUnquoted = new RegExp(`(${key})\\s*[:=]\\s*[^\\s&,;"]+`, "gi");
    out = out.replace(reUnquoted, "$1=[redacted]");
  }

  // 4. Limita o tamanho máximo do erro armazenado
  if (out.length > 1000) {
    out = out.slice(0, 999) + "…";
  }

  return out;
}

// Junta falhas anteriores com as novas, removendo duplicadas por (channel, error)
// (mantendo a ocorrência mais recente, incrementando contagem) e limitando o tamanho da fila.
export function mergePendingFailures(priorPending = [], newFailures = [], nowIso = new Date().toISOString(), maxPending = 20) {
  // Deep copy/normalize to avoid mutating input array
  const merged = priorPending.map(f => ({
    id: f.id || crypto.randomUUID(),
    channel: f.channel,
    first_seen_at: f.first_seen_at || f.at || nowIso,
    last_seen_at: f.last_seen_at || f.at || nowIso,
    error: f.error || "unknown",
    count: f.count || 1
  }));

  for (const nf of newFailures) {
    if (!nf || !nf.channel) continue;
    const keyError = nf.error || "unknown";
    const existing = merged.find(f => f.channel === nf.channel && f.error === keyError);
    if (existing) {
      existing.last_seen_at = nf.last_seen_at || nf.at || nowIso;
      existing.count += 1;
    } else {
      merged.push({
        id: nf.id || crypto.randomUUID(),
        channel: nf.channel,
        first_seen_at: nf.first_seen_at || nf.at || nowIso,
        last_seen_at: nf.last_seen_at || nf.at || nowIso,
        error: keyError,
        count: nf.count || 1
      });
    }
  }

  merged.sort((a, b) => Date.parse(a.last_seen_at) - Date.parse(b.last_seen_at));

  if (merged.length > maxPending) {
    return merged.slice(merged.length - maxPending);
  }
  return merged;
}

// Auxiliar para converter status legado para formato de fila de pendências
function convertLegacyStatusToPending(status) {
  const pending = [];
  if (status.email === "failed") {
    pending.push({
      id: crypto.randomUUID(),
      channel: "email",
      first_seen_at: status.generated_at,
      last_seen_at: status.generated_at,
      error: status.email_error || "failed",
      count: 1
    });
  }
  if (status.whatsapp === "failed") {
    pending.push({
      id: crypto.randomUUID(),
      channel: "whatsapp",
      first_seen_at: status.generated_at,
      last_seen_at: status.generated_at,
      error: status.whatsapp_error || "failed",
      count: 1
    });
  }
  return pending;
}

// Junta acks removendo duplicatas e limitando ao maxAcks
export function mergeAcks(localAcks = [], ciAcks = [], maxAcks = 100) {
  const merged = Array.from(new Set([...localAcks, ...ciAcks]));
  if (merged.length > maxAcks) {
    return merged.slice(merged.length - maxAcks);
  }
  return merged;
}

// Reconcilia as filas de pendência dos status local e CI.
// Remove apenas pendências cujo ID esteja presente na lista de acknowledged_failure_ids consolidada.
export function reconcilePendingFailures(localStatus, ciStatus) {
  const localPending = localStatus?.pending_failures || (localStatus && !localStatus.pending_failures ? convertLegacyStatusToPending(localStatus) : []);
  const ciPending = ciStatus?.pending_failures || (ciStatus && !ciStatus.pending_failures ? convertLegacyStatusToPending(ciStatus) : []);

  // Merge prior lists of pending failures
  const mergedPending = [];
  const allPending = [...localPending, ...ciPending];
  for (const f of allPending) {
    if (!f || !f.channel) continue;
    const norm = {
      id: f.id || crypto.randomUUID(),
      channel: f.channel,
      first_seen_at: f.first_seen_at || f.at || new Date().toISOString(),
      last_seen_at: f.last_seen_at || f.at || new Date().toISOString(),
      error: f.error || "unknown",
      count: f.count || 1
    };
    const existing = mergedPending.find(x => x.channel === norm.channel && x.error === norm.error);
    if (existing) {
      if (f.id && !existing.id) existing.id = f.id;
      existing.first_seen_at = new Date(Math.min(Date.parse(existing.first_seen_at), Date.parse(norm.first_seen_at))).toISOString();
      existing.last_seen_at = new Date(Math.max(Date.parse(existing.last_seen_at), Date.parse(norm.last_seen_at))).toISOString();
      existing.count = Math.max(existing.count, norm.count);
    } else {
      mergedPending.push(norm);
    }
  }

  // Merge acknowledged lists
  const localAcks = localStatus?.acknowledged_failure_ids || [];
  const ciAcks = ciStatus?.acknowledged_failure_ids || [];
  const allAcks = mergeAcks(localAcks, ciAcks);

  return mergedPending.filter(f => !allAcks.includes(f.id));
}

// Constrói o registro de entrega desta rodada.
export function buildDeliveryStatus({ now = new Date(), sendingEmail, email, whatsapp, pendingFailures = [], acknowledgedFailureIds = [], source } = {}) {
  const status = {
    generated_at: now.toISOString(),
    source: source || (process.env.GITHUB_ACTIONS === "true" ? "ci" : "local")
  };

  const delivery = {};

  if (!sendingEmail) {
    delivery.email = "skipped";
  } else if (email?.ok) {
    delivery.email = "sent";
  } else {
    delivery.email = "failed";
    if (email?.error) delivery.email_error = sanitizeErrorMessage(email.error);
  }

  if (whatsapp?.ok) {
    delivery.whatsapp = "sent";
  } else {
    delivery.whatsapp = "failed";
    if (whatsapp?.error) delivery.whatsapp_error = sanitizeErrorMessage(whatsapp.error);
  }

  status.delivery = delivery;
  status.pending_failures = pendingFailures;
  status.acknowledged_failure_ids = acknowledgedFailureIds;

  // Flattened for backward compatibility
  status.email = delivery.email;
  if (delivery.email_error) status.email_error = delivery.email_error;
  status.whatsapp = delivery.whatsapp;
  if (delivery.whatsapp_error) status.whatsapp_error = delivery.whatsapp_error;

  return status;
}

// Nota a incluir na PRÓXIMA notificação quando a rodada anterior falhou em algum
// canal. Retorna string curta ou null (quando não houve falha anterior).
export function buildPriorFailureNote(input) {
  if (!input) return null;
  let pending = [];
  if (Array.isArray(input)) {
    pending = input;
  } else if (input.pending_failures) {
    pending = input.pending_failures;
  } else {
    // Old status format backward compatibility
    if (input.email === "failed") {
      pending.push({ id: crypto.randomUUID(), channel: "email", first_seen_at: input.generated_at, last_seen_at: input.generated_at });
    }
    if (input.whatsapp === "failed") {
      pending.push({ id: crypto.randomUUID(), channel: "whatsapp", first_seen_at: input.generated_at, last_seen_at: input.generated_at });
    }
  }

  if (pending.length === 0) return null;

  const failedChannels = [];
  const hasEmail = pending.some(f => f.channel === "email");
  const hasWhatsapp = pending.some(f => f.channel === "whatsapp");

  if (hasEmail) failedChannels.push("e-mail");
  if (hasWhatsapp) failedChannels.push("WhatsApp");

  const times = Array.from(new Set(pending.map(f => f.last_seen_at || f.first_seen_at || f.at).filter(Boolean)));
  const whenStr = times.length === 1 ? ` (${times[0]})` : "";

  return `⚠️ Rodada anterior${whenStr}: falha ao notificar por ${failedChannels.join(" e ")}.`;
}
