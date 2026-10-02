import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readMercadoLivreSchedule } from "./lib/mercadolivre-scheduler.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const forwarded = process.argv.slice(2);

// Continua após falhas isoladas, mas interrompe toda a fila se o perfil ficar
// bloqueado. Mesmo --force/--clear-cooldown não devem iniciar outra lista após
// um desafio novo detectado nos notebooks. Os relatórios parciais são mantidos.
const errors = [];
for (const script of ["monitor-mercadolivre-notebooks.mjs", "monitor-mercadolivre-watchlists.mjs"]) {
  try {
    await run(script, forwarded);
  } catch (error) {
    console.error(`Aviso: ${error.message}`);
    errors.push(error.message);
  }
  const schedule = await readMercadoLivreSchedule(root);
  if (schedule.global.requires_login || Date.parse(schedule.global.blocked_until ?? "") > Date.now()) {
    console.error("Fila Mercado Livre interrompida por verificacao, limite ou login; demais buscas nao executadas.");
    if (!errors.length) errors.push("Fila Mercado Livre bloqueada.");
    break;
  }
}
if (errors.length) process.exitCode = 1;

function run(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "scripts", script), ...args], {
      cwd: root,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${script} saiu com codigo ${code}`)));
  });
}
