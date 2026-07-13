import crypto from "node:crypto";
import { classifyMonitorError } from "./monitor-errors.mjs";
import { sanitizeErrorMessage } from "./notification-status.mjs";

const MAX_OUTBOX_ITEMS = 40;

export function notificationDedupeKey(channel, payload) {
  return crypto.createHash("sha256").update(`${channel}\0${JSON.stringify(payload)}`).digest("hex").slice(0, 24);
}

export function enqueueNotification(outbox = [], { channel, payload }, now = new Date()) {
  const dedupeKey = notificationDedupeKey(channel, payload);
  const existing = outbox.find((item) => item.dedupe_key === dedupeKey && item.status !== "sent");
  if (existing) return outbox;
  const item = {
    id: crypto.randomUUID(),
    dedupe_key: dedupeKey,
    channel,
    payload,
    status: "pending",
    attempts: 0,
    next_attempt_at: now.toISOString(),
    last_error: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  return [...outbox, item].slice(-MAX_OUTBOX_ITEMS);
}

export function reconcileNotificationOutbox(...statuses) {
  const byId = new Map();
  for (const status of statuses) {
    for (const item of status?.notification_outbox ?? []) {
      if (!item?.id || item.status === "sent") continue;
      const current = byId.get(item.id);
      if (!current || Date.parse(item.updated_at ?? 0) > Date.parse(current.updated_at ?? 0)) byId.set(item.id, item);
    }
  }
  return [...byId.values()].slice(-MAX_OUTBOX_ITEMS);
}

export function readyNotificationItems(outbox = [], now = new Date()) {
  const timestamp = now.getTime();
  return outbox.filter((item) => ["pending", "retry_wait"].includes(item.status) && Date.parse(item.next_attempt_at ?? 0) <= timestamp);
}

export function recoverAbandonedNotifications(outbox = [], now = new Date(), { staleMs = 5 * 60 * 1000 } = {}) {
  return outbox.map((item) => {
    if (item.status !== "sending") return item;
    const startedAt = Date.parse(item.sending_at ?? item.updated_at ?? "");
    if (Number.isFinite(startedAt) && now.getTime() - startedAt < staleMs) return item;
    return {
      ...item,
      status: "retry_wait",
      next_attempt_at: now.toISOString(),
      last_error: "Tentativa anterior interrompida; reagendada de forma conservadora.",
      updated_at: now.toISOString(),
      sending_at: null,
    };
  });
}

export function claimNotification(outbox, id, now = new Date()) {
  return outbox.map((item) => item.id !== id ? item : {
    ...item,
    status: "sending",
    attempts: Number(item.attempts ?? 0) + 1,
    sending_at: now.toISOString(),
    updated_at: now.toISOString(),
  });
}

export function settleNotification(outbox, id, { ok, error }, now = new Date()) {
  return outbox.flatMap((item) => {
    if (item.id !== id) return [item];
    if (ok) return [];
    const attempts = item.status === "sending" ? Number(item.attempts ?? 0) : Number(item.attempts ?? 0) + 1;
    const classified = classifyMonitorError(error);
    const retryable = classified.retriable;
    const delayMs = Math.min(60 * 60 * 1000, 60_000 * 2 ** Math.max(0, attempts - 1));
    return [{
      ...item,
      attempts,
      status: retryable ? "retry_wait" : "blocked",
      next_attempt_at: retryable ? new Date(now.getTime() + delayMs).toISOString() : null,
      last_error: sanitizeErrorMessage(classified.message),
      updated_at: now.toISOString(),
      sending_at: null,
    }];
  });
}
