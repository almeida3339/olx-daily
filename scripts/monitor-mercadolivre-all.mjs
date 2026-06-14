import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const forwarded = process.argv.slice(2);

await run("monitor-mercadolivre-notebooks.mjs", forwarded);
await run("monitor-mercadolivre-watchlists.mjs", forwarded);

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
