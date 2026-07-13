import crypto from "node:crypto";
import { sanitizeErrorMessage } from "./notification-status.mjs";

export function createMonitorLogger({ monitor, runId = crypto.randomUUID(), now = () => Date.now() } = {}) {
  const startedAt = now();
  const emit = (level, event, extra = {}) => {
    const payload = {
      level,
      event,
      monitor,
      run_id: runId,
      at: new Date().toISOString(),
      elapsed_ms: now() - startedAt,
      ...extra,
    };
    if (level === "error") console.error(JSON.stringify(payload));
    else console.log(JSON.stringify(payload));
  };
  return {
    runId,
    start: (extra) => emit("info", "run_started", extra),
    info: (event, extra) => emit("info", event, extra),
    warn: (event, extra) => emit("warn", event, extra),
    error: (event, error, extra) => emit("error", event, { ...extra, error: sanitizeErrorMessage(error?.message ?? error) }),
    done: (extra) => emit("info", "run_finished", extra),
  };
}
