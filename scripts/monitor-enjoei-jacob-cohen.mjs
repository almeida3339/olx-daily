import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEnjoeiJeansMonitor } from './lib/enjoei-jeans-monitor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
runEnjoeiJeansMonitor({
  id: 'enjoei-jacob-cohen', label: 'Enjoei Jeans Jacob Cohën 40', brandName: 'Jacob Cohën',
  term: 'jacob cohen', brandPattern: /\bjacob[\s-]+cohen\b/,
  dataDir: process.env.ENJOEI_JACOB_COHEN_DATA_DIR ?? path.join(root, 'data', 'enjoei-jacob-cohen'),
  maxPrice: 250, inclusive: false,
}).catch(error => { console.error(error); process.exitCode = 1; });
