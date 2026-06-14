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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profileDir = process.env.MERCADOLIVRE_PROFILE_DIR ?? path.join(root, ".chrome-mercadolivre-profile");
const dataDir = process.env.MERCADOLIVRE_NOTEBOOKS_DATA_DIR ?? path.join(root, "data", "mercadolivre-notebooks");
const requested = option("--cpu");
const cpuTerms = requested ? [requested.toLowerCase()] : DEFAULT_CPU_TERMS;

await runMercadoLivreBatch({
  id: "notebooks",
  label: "Notebooks por CPU",
  dataDir,
  profileDir,
  terms: cpuTerms.map((term) => ({ query: cpuSearchQuery(term), matchTerm: term })),
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

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
