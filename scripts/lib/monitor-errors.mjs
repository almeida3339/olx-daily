const TRANSIENT_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /network/i,
  /econnreset/i,
  /econnrefused/i,
  /err_network/i,
  /http 5\d\d/i,
  /temporar/i,
];

export function classifyMonitorError(error) {
  const message = String(error?.message ?? error ?? "erro desconhecido");
  const state = error?.pageState;
  if (state === "challenge" || /captcha|verifica[cç][aã]o|n[aã]o sou um rob[oó]/i.test(message)) {
    return { kind: "challenge", retriable: false, message };
  }
  if (state === "logged_out" || /sess[aã]o expirada|fa[cç]a login|logged.?out/i.test(message)) {
    return { kind: "authentication", retriable: false, message };
  }
  if (state === "limited" || /http 429|limitou|rate.?limit|muitas solicita[cç][oõ]es/i.test(message)) {
    return { kind: "rate_limited", retriable: false, message };
  }
  if (/json|schema|invalido|invalid/i.test(message)) {
    return { kind: "validation", retriable: false, message };
  }
  if (TRANSIENT_PATTERNS.some((pattern) => pattern.test(message))) {
    return { kind: "transient", retriable: true, message };
  }
  return { kind: "unknown", retriable: false, message };
}

export function retryDelayMs(attempt) {
  return Math.min(60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

export async function retryTransient(operation, { maxAttempts = 2, sleep, onRetry } = {}) {
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await operation(attempt);
    } catch (error) {
      const classification = classifyMonitorError(error);
      if (!classification.retriable || attempt >= maxAttempts) throw error;
      const delayMs = retryDelayMs(attempt);
      await onRetry?.({ attempt, delayMs, classification });
      await sleep?.(delayMs);
    }
  }
  throw new Error("Tentativas esgotadas");
}
