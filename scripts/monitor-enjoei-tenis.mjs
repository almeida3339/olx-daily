import { setMonitorExit } from './lib/monitor-outcome.mjs';
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildMonitorChanges,
  mergeMonitorSnapshot,
} from "./lib/monitor-core.mjs";
import { commitMonitorRun, readLatestValidSnapshot } from "./lib/monitor-runtime.mjs";
import { recordRunFindings } from './lib/collection-summary.mjs';
import { matchesEnjoeiShoeSearchTerm, classifyBarefootShoe, SHOE_RULES_VERSION, barefootPriority } from "./lib/shoe-search-rules.mjs";
import { ENJOEI_SHOE_PLAN } from './lib/enjoei-shoe-plan.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const automationRoot = process.env.ENJOEI_DATA_DIR ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".codex", "automations", "monitor-enjoei-tenis-42");

import { collectEnjoeiShoes } from "./lib/enjoei-shoe-collection.mjs";
const SITE_ORIGIN = "https://www.enjoei.com.br";
const DEFAULT_TERMS = ENJOEI_SHOE_PLAN.map(spec => spec.id);

const args = process.argv.slice(2);
const explicitTerms = args.includes('--term') || args.includes('--terms');
const terms = getTerms();
const department = getOptionValue(args, "--department") ?? "masculino";
const shoeSize = getOptionValue(args, "--shoe-size") ?? "42";
const shippingRange = getOptionValue(args, "--shipping-range") ?? "same_country";
const state = getOptionValue(args, "--state") ?? "pr";
const city = getOptionValue(args, "--city") ?? "curitiba";
const first = Number(getOptionValue(args, "--first") ?? 30);
const maxPriceBrl = Number(getOptionValue(args, "--max-price") ?? 500);

main().catch((error) => {
  console.error(`\nFalha: ${formatError(error)}`);
  process.exitCode = 1;
});

function formatError(error) {
  if (!error) return "Erro desconhecido (sem detalhes).";
  const message = error.stack || error.message || String(error);
  const cause = error.cause;
  if (!cause) return message;
  const causeMessage = cause.stack || cause.message || String(cause);
  return `${message}\nCausa: ${causeMessage}`;
}

async function main() {
  const now = new Date();
  const runDate = now.toISOString().slice(0, 10);
  const runTimestamp = now.toISOString();
  const runId = runTimestamp.replace(/[:.]/g, "-");

  const previousSnapshotResult = await readLatestValidSnapshot(automationRoot);
  const previousSnapshotPath = previousSnapshotResult.file ? path.join(automationRoot, previousSnapshotResult.file) : null;
  const previousSnapshot = previousSnapshotResult.snapshot;

  console.log(`Execucao: ${runTimestamp}`);
  console.log(`Buscas: ${terms.join(", ")}`);
  console.log(`Filtro: tenis ${shoeSize}, ${department}, ${shippingRange}, ate R$ ${maxPriceBrl}`);
  console.log(`Snapshot anterior: ${previousSnapshotPath ?? "(nenhum)"}`);
  console.log("");

  const limits = {
    maxPagesPerTerm: Number(process.env.ENJOEI_SHOE_PAGES_PER_TERM ?? 2),
    maxPages: Number(process.env.ENJOEI_SHOE_MAX_PAGES ?? 12),
    discoveryPages: Number(process.env.ENJOEI_SHOE_DISCOVERY_PAGES ?? 6),
    maxMinutes: Number(process.env.ENJOEI_SHOE_MAX_MINUTES ?? 3),
    detailMax: Number(process.env.ENJOEI_SHOE_DETAIL_MAX ?? 4),
  };
  if (![first, ...Object.values(limits)].every(v => Number.isInteger(v) && v > 0)
      || !Number.isFinite(maxPriceBrl) || maxPriceBrl <= 0) throw new Error('Limites de coleta inválidos');
  const collection = await collectEnjoeiShoes({ dataDir: automationRoot, terms, explicitTerms, department, shoeSize, shippingRange, state, city, first, maxPriceBrl, ...limits });
  const { items: collected, failedTerms, incompleteTerms, pendingItems } = collection;
  const completedAt = new Date();
  const snapshot = mergeWithPreviousSnapshot({ now: completedAt, collected, collection, previousSnapshot });
  const knownIds = new Set([...collected, ...pendingItems].map(item => item.id));
  const rejectedCachedIds = new Set(collection.rejectedCachedIds);
  snapshot.pending_items = [...pendingItems, ...(previousSnapshot?.pending_items ?? []).filter(item => !knownIds.has(item.id)
    && !rejectedCachedIds.has(item.id)
    && classifyBarefootShoe(item).state === 'pending'
    && !(item.search_terms ?? []).every(term => collection.successfulTerms.includes(term)))];
  snapshot.run.started_at = runTimestamp;
  snapshot.run.completed_at = completedAt.toISOString();
  snapshot.run.failed_terms = failedTerms;
  snapshot.run.incomplete_terms = incompleteTerms;
  snapshot.run.errors = collection.errors;
  snapshot.run.pagination = collection.pagination;
  snapshot.run.discovery = collection.stats;
  snapshot.run.search_schedule = collection.schedule;
  snapshot.run.deferred_terms = collection.deferredTerms;
  snapshot.run.discovery.pending_details = pendingItems.filter(item => !item.barefoot_validation.description_checked_at).length;
  snapshot.run.partial ||= pendingItems.some(item => barefootPriority(item) === 0 && !item.barefoot_validation.description_checked_at);
  console.log(JSON.stringify({ confirmed: collected.length, pending: pendingItems.length, ...collection.stats }));

  const report = buildReport({ runDate, snapshot, previousSnapshot });
  const committed = await commitMonitorRun(automationRoot, {
    runId,
    snapshot,
    report,
    metadata: { source: "enjoei-tenis", collected_count: collected.length, pending_count: pendingItems.length,
      failed_term_count: failedTerms.length, incomplete_term_count: incompleteTerms.length },
  });
  const snapshotPath = committed.legacySnapshotPath;
  const reportPath = committed.legacyReportPath;

  console.log(`Produtos coletados: ${collected.length}`);
  console.log(`Snapshot salvo: ${snapshotPath}`);
  console.log(`Relatorio salvo: ${reportPath}`);
  if (committed.invalidItems.length) console.warn(`${committed.invalidItems.length} item(ns) foram para a quarentena.`);
  setMonitorExit(committed.snapshot.run);
}

function buildSearchPageUrl(searchTerm) {
  const spec = ENJOEI_SHOE_PLAN.find(spec => spec.id === searchTerm);
  const queryTerm = spec?.term ?? searchTerm;
  const url = new URL(`${SITE_ORIGIN}/${encodeURIComponent(queryTerm)}/s`);
  url.searchParams.set("ref", "products_search");
  url.searchParams.set("q", queryTerm);
  if (spec?.department !== null) url.searchParams.set("d", department);
  url.searchParams.set("st[ss]", shoeSize);
  url.searchParams.set("sr", shippingRange);
  return url.toString();
}

function mergeWithPreviousSnapshot({ now, collected, collection, previousSnapshot }) {
  const failedTerms = [...collection.failedTerms, ...collection.incompleteTerms];
  const previousItems = (previousSnapshot?.items ?? []).filter(
    (item) => (item.price_brl == null || item.price_brl <= maxPriceBrl) && isConfirmedItem(item)
  );
  const snapshot = mergeMonitorSnapshot({
    previousSnapshot: previousSnapshot ? { ...previousSnapshot, items: previousItems } : null,
    collected,
    now,
    run: {
      id: "enjoei-tenis-42",
      label: "Enjoei Tenis 42",
      partial: collection.failedTerms.length > 0 || collection.incompleteTerms.length > 0 || collection.deferredTerms.length > 0,
      failed_term_count: collection.failedTerms.length,
      deferred_terms: collection.deferredTerms,
    },
    configuredCoverage: DEFAULT_TERMS,
    scheduledCoverage: collection.scheduledTerms,
    successfulCoverage: collection.successfulTerms,
    failedCoverage: failedTerms,
    itemCoverage: (item) => item.search_terms ?? [],
    filters: {
      price_brl: { min: 0, max: maxPriceBrl },
      shoe_size: shoeSize,
      department,
      shipping_range: shippingRange,
    },
  });
  snapshot.search = {
    terms: collection.scheduledTerms,
    department,
    shoe_size: shoeSize,
    shipping_range: shippingRange,
    max_price_brl: maxPriceBrl,
    source_urls: collection.scheduledTerms.map((searchTerm) => buildSearchPageUrl(searchTerm)),
  };
  return snapshot;
}

function buildReport({ runDate, snapshot, previousSnapshot }) {
  const currentItems = snapshot.items.filter((item) => item.status === "active");
  const previousComparableItems = (previousSnapshot?.items ?? []).filter(
    (item) => (item.price_brl == null || item.price_brl <= maxPriceBrl) && isConfirmedItem(item)
  );
  const previousById = new Map(previousComparableItems.map((item) => [item.id ?? item.url, item]));
  const currentById = new Map(currentItems.map((item) => [item.id ?? item.url, item]));

  const { newItems, priceChanges: sharedPriceChanges } = buildMonitorChanges(
    { items: previousComparableItems },
    snapshot,
    { reactivationIsNew: false },
  );
  const stillActive = currentItems.filter((item) => previousById.has(item.id ?? item.url));
  const pendingIds = new Set((snapshot.pending_items ?? []).map(item => item.id));
  const notSeenThisRun = previousComparableItems
    .filter((item) => item.status === "active")
    .filter((item) => !currentById.has(item.id ?? item.url) && !pendingIds.has(item.id));

  const priceChanges = sharedPriceChanges.map((item) => ({
    item,
    from: item.previous_price_brl,
    to: item.price_brl,
  }));

  const lines = [];
  recordRunFindings(snapshot, { newItems, priceChanges, activeItems: currentItems });
  lines.push(`# Monitor Enjoei tenis ${shoeSize} ate R$ ${formatBrl(maxPriceBrl)} - ${runDate}`);
  lines.push("");
  lines.push("## Resumo executivo");
  lines.push(`- Novos produtos: **${newItems.length}**`);
  const prunedTerms = Object.entries(snapshot.run.pagination ?? {}).filter(([, value]) => value.complete && !value.exhaustive).map(([term]) => term);
  if (prunedTerms.length) lines.push(`- Paginação encerrada por falta de correspondência na primeira página: ${prunedTerms.join(', ')}. Critério de relevância; não comprova ausência nas páginas seguintes.`);
  lines.push(`- Produtos ainda ativos ja vistos: **${stillActive.length}**`);
  lines.push(`- Nao vistos nesta rodada: **${notSeenThisRun.length}**`);
  lines.push(`- Alteracoes de preco: **${priceChanges.length}**`);
  lines.push(`- Termos: ${snapshot.search.terms.join(", ")}`);
  lines.push(`- Cobertura parcial: **${snapshot.run.partial ? 'sim' : 'não'}**`);
  lines.push(`- Termos com paginação pendente: ${(snapshot.run.incomplete_terms ?? []).join(', ') || 'nenhum'}`);
  lines.push(`- Termos adiados pelo orçamento: ${(snapshot.run.deferred_terms ?? []).join(', ') || 'nenhum'}`);
  lines.push('- Prioridade: Fiber e FOT somente Walka, Lito, Noga, Voet e Bruk. Numeração 42; teto de descoberta R$500.');
  lines.push(`- Candidatos pendentes de conferência: **${(snapshot.pending_items ?? []).length}**`);
  lines.push(`- Páginas nesta rodada: **${snapshot.run.discovery.pages_fetched}**; descrições: **${snapshot.run.discovery.details_fetched}/${snapshot.run.discovery.detail_budget}**; cache: **${snapshot.run.discovery.cache_hits}**.`);
  lines.push('- Confirmação automática por marca/modelo ou características declaradas; não comprova autenticidade ou estado físico.');
  lines.push(`- Preco maximo: R$ ${formatBrl(snapshot.search.max_price_brl)}`);
  lines.push("");

  lines.push('## Cobertura por termo');
  for (const [term, schedule] of Object.entries(snapshot.run.search_schedule)) {
    const progress = snapshot.run.pagination[term];
    lines.push(`- ${term}: ${schedule.tier}; última conclusão: ${schedule.last_success_at ?? 'ainda não concluída'}; ${schedule.state}${schedule.pending ? '; paginação pendente' : ''}${progress ? `; ${progress.pages} página(s) acumuladas no ciclo` : ''}.`);
  }
  lines.push('');
  lines.push('## Rendimento das consultas desta rodada');
  lines.push('- Exclusivo significa encontrado somente por esta consulta entre as consultas executadas nesta rodada; não comprova exclusividade histórica.');
  for (const [term, metrics] of Object.entries(snapshot.run.discovery.query_yield ?? {})) {
    lines.push(`- ${term}: ${metrics.pages_this_run} página(s) novas; ${metrics.confirmed_in_run} confirmado(s), ${metrics.exclusive_in_run} exclusivo(s) nesta rodada; ${metrics.pending_in_run} pendente(s).`);
  }
  lines.push('');
  lines.push("## Novos produtos");
  if (newItems.length === 0) {
    lines.push("- Nenhum.");
  } else {
    for (const item of sortByPrice(newItems)) lines.push(formatItemLine(item));
  }
  lines.push("");

  if (priceChanges.length > 0) {
    lines.push("## Mudancas de preco");
    for (const change of priceChanges.sort((a, b) => a.to - b.to)) {
      lines.push(
        `- R$ ${formatBrl(change.from)} -> R$ ${formatBrl(change.to)} - ${change.item.title} - ${change.item.url}`
      );
    }
    lines.push("");
  }

  lines.push("## Produtos ainda ativos");
  if (stillActive.length === 0) {
    lines.push("- Nenhum.");
  } else {
    for (const item of sortByPrice(stillActive)) lines.push(formatItemLine(item));
  }
  lines.push("");

  if (notSeenThisRun.length > 0) {
    lines.push("## Nao vistos nesta rodada");
    lines.push("- Observacao: ausencia na busca nao garante que o produto foi removido; apenas que nao apareceu nesta coleta.");
    for (const item of sortByPrice(notSeenThisRun)) lines.push(formatItemLine(item));
    lines.push("");
  }

  lines.push('## Candidatos pendentes de conferência');
  lines.push('- Candidatos não entram nos alertas de ofertas confirmadas.');
  for (const item of sortByPrice(snapshot.pending_items ?? [])) {
    lines.push(`${formatItemLine(item)} — Pendente: ${item.barefoot_validation.reason}`);
  }
  lines.push('');
  return lines.join("\n");
}

function formatItemLine(item) {
  const brand = item.brand ? ` - ${item.brand}` : "";
  const store = item.store_name ? ` - vendedor: ${item.store_name}` : "";
  const shipping = item.shipping_free ? " - frete gratis" : "";
  const matchedTerms = item.search_terms?.length ? ` - termos: ${item.search_terms.join(", ")}` : "";
  return `- R$ ${formatBrl(item.price_brl)} - ${item.title}${brand} - tam. ${item.size}${store}${shipping}${matchedTerms} - ${item.url}`;
}

function sortByPrice(items) {
  return items.slice().sort((a, b) => barefootPriority(a) - barefootPriority(b) || (a.price_brl ?? Infinity) - (b.price_brl ?? Infinity));
}

function isConfirmedItem(item) {
  if (classifyBarefootShoe(item).state === 'rejected') return false;
  return item.size === shoeSize && itemMatchesAnySearchTerm(item)
    && (item.barefoot_validation?.version === SHOE_RULES_VERSION
      ? item.barefoot_validation.state === 'confirmed'
      : classifyBarefootShoe(item).state === 'confirmed');
}

function itemMatchesAnySearchTerm(item) {
  return DEFAULT_TERMS.some((searchTerm) => itemMatchesSearchTerm(item, searchTerm));
}

function itemMatchesSearchTerm(item, searchTerm) {
  return matchesEnjoeiShoeSearchTerm(item, searchTerm);
}

function formatBrl(value) {
  if (value == null || !Number.isFinite(Number(value))) return "n/d";
  return Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getOptionValue(values, name) {
  const index = values.indexOf(name);
  if (index === -1) return null;
  return values[index + 1] ?? null;
}

function getTerms() {
  const term = getOptionValue(args, "--term");
  const termsArg = getOptionValue(args, "--terms");
  const rawTerms = termsArg ? termsArg.split(",") : term ? [term] : DEFAULT_TERMS;
  return Array.from(new Set(rawTerms.map((value) => value.trim()).filter(Boolean)));
}
