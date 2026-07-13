import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonAtomic } from "./lib/monitor-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const id = option("--retry") ?? option("--discard");
const action = args.includes("--retry") ? "retry" : args.includes("--discard") ? "discard" : "list";
const source = option("--source") ?? "local";
const filePath = path.join(root, "data", "status", `latest-${source}.json`);

const status = JSON.parse(await fs.readFile(filePath, "utf8"));
const outbox = Array.isArray(status.notification_outbox) ? status.notification_outbox : [];

if (action === "list") {
  if (!outbox.length) console.log("Nao ha notificacoes pendentes.");
  for (const item of outbox) {
    console.log(`${item.id} | ${item.channel} | ${item.status} | tentativas: ${item.attempts ?? 0} | ${item.last_error ?? ""}`);
  }
} else if (!id) {
  throw new Error(`Use --${action} <id>.`);
} else if (action === "retry") {
  const found = outbox.find((item) => item.id === id);
  if (!found) throw new Error("Notificacao nao encontrada.");
  found.status = "pending";
  found.next_attempt_at = new Date().toISOString();
  found.sending_at = null;
  found.last_error = null;
  found.updated_at = new Date().toISOString();
  await save(status);
  console.log(`Notificacao ${id} liberada para nova tentativa.`);
} else {
  const next = outbox.filter((item) => item.id !== id);
  if (next.length === outbox.length) throw new Error("Notificacao nao encontrada.");
  status.notification_outbox = next;
  await save(status);
  console.log(`Notificacao ${id} descartada.`);
}

async function save(value) {
  value.generated_at = new Date().toISOString();
  await writeJsonAtomic(filePath, value, { validate: null });
}

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
