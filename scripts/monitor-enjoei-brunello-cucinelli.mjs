import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEnjoeiJeansMonitor } from './lib/enjoei-jeans-monitor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
runEnjoeiJeansMonitor({
  id: 'enjoei-brunello-cucinelli', label: 'Enjoei Jeans Brunello Cucinelli 40', brandName: 'Brunello Cucinelli',
  term: 'brunello cucinelli', brandPattern: /\bbrunello[\s-]+cucinelli\b/,
  dataDir: process.env.ENJOEI_BRUNELLO_CUCINELLI_DATA_DIR ?? path.join(root, 'data', 'enjoei-brunello-cucinelli'),
  maxPrice: 400, inclusive: true,
}).catch(error => { console.error(error); process.exitCode = 1; });
