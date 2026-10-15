import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENJOEI_JAPANESE_JEANS } from './lib/enjoei-japanese-jeans.mjs';
import { runEnjoeiJeansMonitor } from './lib/enjoei-jeans-monitor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = process.argv.indexOf('--watchlist');
const selected = index < 0 ? null : process.argv[index + 1];
const specs = selected ? ENJOEI_JAPANESE_JEANS.filter(spec => spec.id === selected || spec.slug === selected) : ENJOEI_JAPANESE_JEANS;
if (!specs.length || (index >= 0 && !selected)) throw new Error('Marca de jeans desconhecida');
for (const spec of specs) {
  try {
    await runEnjoeiJeansMonitor({ ...spec, dataDir: process.env[spec.env] ?? path.join(root, 'data', spec.repoFolder) });
  } catch (error) { console.error(`${spec.brandName}: ${error.message}`); process.exitCode = 1; }
  if (spec !== specs.at(-1)) await new Promise(resolve => setTimeout(resolve, 400));
}
