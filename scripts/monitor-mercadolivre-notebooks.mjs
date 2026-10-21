import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CPU_TERMS, cpuSearchQuery } from "./lib/cpu-terms.mjs";
import { textContainsCpuTerm } from "./lib/parsers.mjs";
import {
  ML_NOTEBOOK_COLLECTION_MAX_BRL,
  ML_NOTEBOOK_COLLECTION_MIN_BRL,
  ML_NOTEBOOK_DISPLAY_MAX_BRL,
  ML_NOTEBOOK_DISPLAY_MIN_BRL,
} from "./lib/mercadolivre-notebook-ranges.mjs";
import { runMercadoLivreBatch } from "./lib/mercadolivre-production.mjs";
import {
  clearMercadoLivreCooldown,
  planMercadoLivreTerms,
  readMercadoLivreSchedule,
  recordMercadoLivreRun,
  writeMercadoLivreSchedule,
} from "./lib/mercadolivre-scheduler.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profileDir = process.env.MERCADOLIVRE_PROFILE_DIR ?? path.join(root, ".chrome-mercadolivre-profile");
const dataDir = process.env.MERCADOLIVRE_NOTEBOOKS_DATA_DIR ?? path.join(root, "data", "mercadolivre-notebooks");
const requested = option("--cpu");
const cpuTerms = requested ? requested.split(',').map(term=>term.trim().toLowerCase()).filter(Boolean) : DEFAULT_CPU_TERMS;
const fullSweep = process.argv.includes("--full-sweep");
const completeCoverage = process.argv.includes("--complete-coverage") || fullSweep;
const collectionStart = Date.now();
const force = process.argv.includes("--force") || fullSweep;
const requestedBudget = Number(option("--max-terms") ?? process.env.ML_NOTEBOOK_TERM_BUDGET ?? 6);
const budget = Number.isFinite(requestedBudget) && requestedBudget > 0 ? Math.floor(requestedBudget) : 6;
let schedule = await readMercadoLivreSchedule(root);
let lastRunPartial = false;
const attemptedThisInvocation=new Set();
if (process.argv.includes("--clear-cooldown")) {
  schedule = clearMercadoLivreCooldown(schedule);
  await writeMercadoLivreSchedule(root, schedule);
  console.log("Pausa de seguranca do Mercado Livre removida.");
}
const configuredTasks = cpuTerms.map((term) => ({ query: cpuSearchQuery(term), matchTerm: term }));
let plan = planMercadoLivreTerms(schedule, {
  watchlistId: "notebooks",
  terms: configuredTasks,
  maxTerms: Math.min(budget, configuredTasks.length),
  force: force || Boolean(requested),
});

if (!plan.terms.length) {
  console.log(`Notebooks: pulado (${plan.reason}${plan.next_at ? ` ate ${plan.next_at}` : ""}).`);
  if (["cooldown", "login_required"].includes(plan.reason)) {
    await writeMercadoLivreSchedule(root, schedule);
    process.exitCode = 1;
  }
} else for (let batch = 0; plan.terms.length && batch < Math.ceil(configuredTasks.length / budget); batch++) {
  console.log(`Notebooks: ${plan.terms.length}/${configuredTasks.length} CPU(s) nesta rodada.`);
  const result = await runMercadoLivreBatch({
  id: "notebooks",
  label: "Notebooks por CPU",
  dataDir,
  profileDir,
  terms: plan.terms,
  allTerms: DEFAULT_CPU_TERMS.map((term) => ({ query: cpuSearchQuery(term), matchTerm: term })),
  minPrice: ML_NOTEBOOK_COLLECTION_MIN_BRL,
  maxPrice: ML_NOTEBOOK_COLLECTION_MAX_BRL,
  displayMinPrice: ML_NOTEBOOK_DISPLAY_MIN_BRL,
  displayMaxPrice: ML_NOTEBOOK_DISPLAY_MAX_BRL,
  termMatcher: textContainsCpuTerm,
  kind: "notebook",
  relevantDetails: ["processador", "memoria", "ssd", "placa grafica", "condicao"],
  searchOptions: {
    categoryPath: "informatica/portateis-acessorios/notebooks",
    localShipping: true,
  },
  });
  lastRunPartial = lastRunPartial || Boolean(result.snapshot.run?.partial);
  schedule = recordMercadoLivreRun(schedule, {
    watchlistId: "notebooks",
    scheduledTerms: plan.terms,
    configuredTerms: DEFAULT_CPU_TERMS.map((term) => ({ query: cpuSearchQuery(term), matchTerm: term })),
    snapshot: result.snapshot,
  });
  await writeMercadoLivreSchedule(root, schedule);
  for(const task of plan.terms)attemptedThisInvocation.add(task.matchTerm??task.query??task);
  const unexpectedFailures=(result.snapshot.run?.failed_terms??[]).filter(entry=>
    !/limite de resultados atingido|ficha(?:s)? pendente(?:s)?/i.test(entry.error??String(entry)));
  if (result.snapshot.run?.aborted || unexpectedFailures.length) {
    console.error("Mercado Livre Notebooks: coleta incompleta; resultados parciais preservados.");
    process.exitCode = 1;
    break;
  }
  if (!completeCoverage || requested) break;
  const pending = configuredTasks.filter((task) => !attemptedThisInvocation.has(task.matchTerm)
    && (Date.parse(schedule.watchlists.notebooks?.terms[task.matchTerm]?.last_success_at ?? '') < collectionStart
      || !schedule.watchlists.notebooks?.terms[task.matchTerm]?.last_success_at));
  plan = planMercadoLivreTerms(schedule, {
    watchlistId: 'notebooks', terms: pending, maxTerms: budget, force,
  });
  if (['cooldown', 'login_required'].includes(plan.reason)) { process.exitCode = 1; break; }
  if (plan.terms.length) console.log(`Lote salvo. Prosseguindo com ${plan.terms.length} CPU(s) pendentes.`);
}

if (lastRunPartial) { console.warn('Notebooks: cobertura limitada ou fichas pendentes; consulte o relatório.'); process.exitCode = 1; }

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
