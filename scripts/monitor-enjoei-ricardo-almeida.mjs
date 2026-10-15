import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEnjoeiJeansMonitor } from './lib/enjoei-jeans-monitor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
runEnjoeiJeansMonitor({
  id: 'enjoei-ricardo-almeida', label: 'Enjoei Jeans Ricardo Almeida 40', brandName: 'Ricardo Almeida',
  term: 'ricardo almeida', brandPattern: /\bricardo[\s-]+almeida\b/,
  dataDir: process.env.ENJOEI_RICARDO_ALMEIDA_DATA_DIR ?? path.join(root, 'data', 'enjoei-ricardo-almeida'),
  maxPrice: 250, inclusive: false,
}).catch(error => { console.error(error); process.exitCode = 1; });
