import path from "node:path";
import { fileURLToPath } from 'node:url';
import { runOledMonitor } from './lib/oled-monitor-runner.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

const dataDir =
  process.env.OLED_MONITORES_DATA_DIR ??
  path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".codex", "automations", "monitor-oled-monitores");

runOledMonitor({root,dataDir}).catch((error) => {
  console.error(`\nFalha: ${error.stack || error.message}`);
  process.exitCode = 1;
});
