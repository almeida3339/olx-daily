import test from 'node:test';
import assert from 'node:assert/strict';
import { extractNotebookRamText, notebookRamGb, assessNotebook } from '../scripts/lib/notebook-policy.mjs';
import { buildMercadoLivreChanges } from '../scripts/lib/mercadolivre-production.mjs';
import { assessMercadoLivreShoe, isApprovedMercadoLivreShoe } from '../scripts/lib/mercadolivre-shoes.mjs';
import { collectMercadoLivrePages, safeMercadoLivreNextUrl } from '../scripts/lib/mercadolivre-pagination.mjs';
import { aggregateMercadoLivreInvocation } from '../scripts/lib/mercadolivre-invocation.mjs';
import { recordRunFindings, buildCollectionSummary } from '../scripts/lib/collection-summary.mjs';
import { recordMercadoLivreRun } from '../scripts/lib/mercadolivre-scheduler.mjs';

test('ML: memória dedicada de vídeo não é RAM, inclusive num valor derivado antigo', () => {
  const description = 'Memória DDR5 a 4800 MHz e placa de vídeo dedicada com 8 GB.';
  assert.equal(extractNotebookRamText(description), null);
  assert.equal(notebookRamGb({ description, ram_gb: 8 }), null);
  assert.equal(extractNotebookRamText(`${description} Memória RAM: 32 GB.`), 32);
  assert.equal(extractNotebookRamText('GPU NVIDIA com 12 GB, 64 GB de RAM'), 64);
  assert.equal(extractNotebookRamText('Memória RAM: 16 GB; GPU com 8 GB'), 16);
});

test('ML: calçado exige barefoot e 42 BR sem converter automaticamente numeração estrangeira', () => {
  const item = { title: 'Tênis FOT Walka', price_brl: 250, specs: ['Tamanho: 42'], details_checked_at: new Date().toISOString() };
  item.shoe_validation = assessMercadoLivreShoe(item);
  assert.equal(isApprovedMercadoLivreShoe(item), true);
  for (const size of ['10 US', '42 EU', '42 UK']) {
    assert.equal(assessMercadoLivreShoe({ ...item, specs: [`Tamanho: ${size}`] }).state, 'pending');
  }
  assert.equal(assessMercadoLivreShoe({ ...item, specs: ['Tamanho: 41'] }).state, 'rejected');
  assert.equal(assessMercadoLivreShoe({ ...item, listing_title: 'Tênis FOT Walka tamanho 41' }).state, 'pending');
  assert.equal(assessMercadoLivreShoe({ ...item, title: 'Tênis FOT Urban' }).state, 'rejected');
  assert.notEqual(assessMercadoLivreShoe({ ...item, title: 'Sapatos masculinos Silvo Chukka Merrell' }).state, 'validated');
  assert.equal(isApprovedMercadoLivreShoe({ ...item, shoe_validation: { ...item.shoe_validation, state: 'pending' } }), false);
});

const initialUrl = 'https://lista.mercadolivre.com.br/notebooks?q=13980hx';
const entry = (id, title = 'Notebook 13980HX 32GB') => ({ id, title, url: `https://produto.mercadolivre.com.br/MLB-${id}`, price_brl: 5000 });
const pageOptions = { initialUrl, matches: item => item.title.includes('13980HX'), accepts: () => true };

test('ML: paginação coleta a próxima página, deduplica e detecta o fim', async () => {
  let calls = 0;
  const result = await collectMercadoLivrePages({ ...pageOptions, fetchPage: async () => ++calls === 1
    ? { items: [entry('1')], nextUrl: '/notebooks_Desde_49', hasNext: true }
    : { items: [entry('1'),entry('2')], hasNext: false } });
  assert.equal(calls, 2); assert.equal(result.complete, true); assert.equal(result.items.length, 2);
});

test('ML: resultados aproximados não geram seis páginas sem correspondência', async () => {
  let calls = 0;
  const result = await collectMercadoLivrePages({ ...pageOptions, fetchPage: async () => {
    calls++; return { items: [entry('1','Outro produto')], nextUrl: '/pagina2', hasNext: true };
  } });
  assert.equal(calls, 1); assert.equal(result.complete, true); assert.equal(result.exhaustive, false);
  assert.equal(result.stop_reason, 'first_page_no_match');
});

test('ML: botão Seguinte controlado por JavaScript permite avançar mesmo sem href', async () => {
  let calls = 0;
  const result = await collectMercadoLivrePages({ ...pageOptions, fetchPage: async cursor => {
    if (++calls === 1) return { items: [entry('1')], hasNext: true, nextAction: { from: initialUrl } };
    assert.equal(cursor.click_next, true); assert.equal(cursor.from, initialUrl);
    return { items: [entry('2')], hasNext: false };
  } });
  assert.equal(calls, 2); assert.equal(result.complete, true); assert.equal(result.items.length, 2);
});

test('ML: limites, página repetida e próximo link desconhecido não viram cobertura completa', async () => {
  let calls = 0;
  let result = await collectMercadoLivrePages({ ...pageOptions, maxPages: 2, fetchPage: async () => ({ items: [entry(String(++calls))], nextUrl: `/page-${calls}`, hasNext: true }) });
  assert.equal(calls, 2); assert.equal(result.complete, false); assert.equal(result.stop_reason, 'page_budget');
  result = await collectMercadoLivrePages({ ...pageOptions, fetchPage: async () => ({ items: [entry('same')], nextUrl: `/page-${++calls}`, hasNext: true }) });
  assert.equal(result.stop_reason, 'repeated_page');
  result = await collectMercadoLivrePages({ ...pageOptions, fetchPage: async () => ({ items: [entry('1')], hasNext: true }) });
  assert.equal(result.stop_reason, 'unrecognized_next_page');
  assert.equal(safeMercadoLivreNextUrl('https://evil.example/pagina', initialUrl), null);
});

test('ML: bloqueio na segunda página preserva resultados e interrompe sem tentar contornar', async () => {
  let calls = 0;
  const error = new Error('verificação'); error.pageState = 'challenge';
  await assert.rejects(() => collectMercadoLivrePages({ ...pageOptions, fetchPage: async () => {
    if (++calls === 2) throw error;
    return { items: [entry('1')], nextUrl: '/page2', hasNext: true };
  } }), failure => failure === error && failure.partialItems.length === 1);
  assert.equal(calls, 2);
});

test('ML: oferta do primeiro lote e queda de preço permanecem no resumo final', () => {
  const invocation = { id: 'same-run', started_at: '2026-10-28T12:00:00Z' };
  const visible = item => item.status === 'active';
  const baselineEligible = () => true;
  const original = { items: [{ ...entry('old'), status: 'active', price_brl: 6000 }] };
  const first = { items: [{ ...entry('old'), status: 'active' },{ ...entry('new'), status: 'active' }], run: {
    started_at: '2026-10-28T12:00:00Z', scheduled_terms: ['cpu1'], successful_terms: ['cpu1'], failed_terms: [],
  } };
  let changes = aggregateMercadoLivreInvocation(original, first, { invocation, visible, baselineEligible, displayMaxPrice: 8000 });
  assert.equal(changes.newItems.length, 1); assert.equal(changes.priceChanges.length, 1);
  const second = structuredClone(first);
  second.run = { started_at: '2026-10-28T12:10:00Z', scheduled_terms: ['cpu2'], successful_terms: [],
    failed_terms: [{ term: 'cpu2', kind: 'incomplete', error: 'Limite de páginas; cobertura incompleta' }], partial: true };
  changes = aggregateMercadoLivreInvocation(first, second, { invocation, visible, baselineEligible, displayMaxPrice: 8000 });
  recordRunFindings(second, changes);
  const summary = buildCollectionSummary(second);
  assert.equal(changes.newItems.length, 1); assert.equal(changes.priceChanges.length, 1);
  assert.equal(summary.coverage.scheduled, 2); assert.equal(summary.coverage.completed, 1);
  assert.equal(summary.findings.new_count, 1); assert.equal(summary.execution, 'success');
  assert.equal(summary.coverage.status, 'partial');
  const third = structuredClone(second); third.run = { ...second.run, started_at: '2026-10-28T13:00:00Z' };
  changes = aggregateMercadoLivreInvocation(second, third, { invocation: { ...invocation, id: 'new-run' }, visible, baselineEligible, displayMaxPrice: 8000 });
  assert.equal(changes.newItems.length, 0); assert.equal(changes.priceChanges.length, 0);
});

test('ML: limite esperado não aumenta falhas técnicas e desafio prevalece sobre fila de fichas', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  const options = { watchlistId: 'notebooks', scheduledTerms: ['13980hx'], now };
  let state = recordMercadoLivreRun({}, { ...options, snapshot: { items: [], run: { failed_terms: [
    { term: '13980hx', kind: 'incomplete', error: 'Limite de páginas' } ] } } });
  assert.equal(state.watchlists.notebooks.terms['13980hx'].failures ?? 0, 0);
  assert.equal(state.watchlists.notebooks.terms['13980hx'].pending_pages, true);
  state = recordMercadoLivreRun(state, { ...options, snapshot: { items: [], run: { pending_detail_terms: ['13980hx'],
    failed_terms: [{ term: '13980hx', error: 'O Mercado Livre exibiu uma verificação.' }] } } });
  assert.ok(Date.parse(state.global.blocked_until) > now.getTime());
});

test('ML: expiração do cache não transforma anúncio conhecido em oferta nova após renovação', () => {
  const old = { ...entry('same'), title: 'Notebook 13980HX 32GB RAM', status: 'active', source: 'Mercado Livre',
    details_checked_at: new Date(Date.now()-48*3600_000).toISOString() };
  old.notebook_validation = assessNotebook(old);
  const current = { ...old, details_checked_at: new Date().toISOString() };
  const changes = buildMercadoLivreChanges({items:[old]}, {items:[current],run:{kind:'notebook'}}, {displayMinPrice:2000,displayMaxPrice:8000});
  assert.equal(changes.newItems.length,0); assert.equal(changes.priceChanges.length,0);
});

test('ML: erro de integridade do lote não é ocultado pelo resumo acumulado', () => {
  const summary = buildCollectionSummary({ items: [], run: { invocation: { operational: { status: 'success' } } } },
    { status: 'failed', reasons: ['Item em quarentena'] });
  assert.equal(summary.execution,'failed');
});
