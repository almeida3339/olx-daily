import childProcess from "node:child_process";
import { sanitizeErrorMessage } from "./notification-status.mjs";

// Forward progress while retaining a bounded diagnostic for failed monitors.
export function runMonitorProcess(command, args, { cwd, env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, { stdio: ["inherit", "pipe", "pipe"], cwd, env });
    let diagnostic = "";
    child.stdout.on("data", (chunk) => stdout.write(chunk));
    child.stderr.on("data", (chunk) => {
      stderr.write(chunk);
      diagnostic = (diagnostic + chunk.toString()).slice(-8000);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) return resolve();
      const detail = sanitizeErrorMessage(diagnostic);
      const outcome = signal ? `Interrompido por ${signal}` : `Saiu com código ${code}`;
      reject(new Error(detail ? `${outcome}: ${detail}` : outcome));
    });
  });
}
