import childProcess from "node:child_process";
import crypto from 'node:crypto';
import { sanitizeErrorMessage } from "./notification-status.mjs";

// Forward progress while retaining a bounded diagnostic for failed monitors.
export function runMonitorProcess(command, args, { cwd, env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  return new Promise((resolve, reject) => {
    const invocation = crypto.randomUUID();
    const child = childProcess.spawn(command, args, { stdio: ["inherit", "pipe", "pipe"], cwd, windowsHide: true,
      env: { ...env, MONITOR_INVOCATION_ID: invocation } });
    let diagnostic = "";
    let buffer = '', committed = [];
    child.stdout.on("data", (chunk) => {
      stdout.write(chunk);
      buffer = (buffer + chunk.toString()).slice(-32000);
      const lines = buffer.split(/\r?\n/); buffer = lines.pop();
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.event === 'monitor_committed' && event.invocation === invocation) committed.push(event.outcome);
        } catch {}
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr.write(chunk);
      diagnostic = (diagnostic + chunk.toString()).slice(-8000);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      const outcome = committed.find(item => ['blocked','failed'].includes(item.status))
        ?? committed.find(item => item.status === 'partial') ?? committed.find(item => item.status === 'deferred') ?? committed.at(-1);
      if (!signal && code === 0 && !['blocked','failed'].includes(outcome?.status)) return resolve(outcome);
      if (!signal && [2,3].includes(code) && outcome?.exit_code === code
          && ['partial','deferred'].includes(outcome.status) && !committed.some(item => ['blocked','failed'].includes(item.status))) return resolve(outcome);
      const detail = sanitizeErrorMessage(diagnostic);
      const exitLabel = signal ? `Interrompido por ${signal}` : `Saiu com código ${code}`;
      const error = new Error(detail ? `${exitLabel}: ${detail}` : exitLabel);
      error.operational = committed.find(item => ['blocked','failed'].includes(item.status)) ?? { status: 'failed' };
      reject(error);
    });
  });
}
