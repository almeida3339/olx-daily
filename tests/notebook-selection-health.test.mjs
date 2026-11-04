import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createDescriptionQueue, descriptionRetryPolicy } from '../scripts/lib/olx-description-queue.mjs';
import { buildMonitorHealth, collectionHealthAlerts } from '../scripts/lib/monitor-health.mjs';
import { LEGACY_OLX_HEALTH_ERROR, reconcileRecordedHealthErrors } from '../scripts/lib/collection-summary.mjs';
import { writeJsonAtomic } from '../scripts/lib/monitor-runtime.mjs';
import { planNotebookFamilies, OLX_NOTEBOOK_FAMILIES, recordFamilyExperiment, notebookPriceLabels } from '../scripts/lib/notebook-search-plan.mjs';

test('410 retires the matching ad across resumes and permits a later listing observation', async t => {
  const {file} = await fixture(t);
  const product = card('154000020', 'Notebook Avell', 6500);
  const term = 'family:avell-a65';
  const first = await createDescriptionQueue(file, 'first');
  await first.enqueue([product], term);
  await first.remember(product, {validation:{state:'pending', detail_diagnostic:{http_status:410, same_ad:true}}});
  const resumed = await createDescriptionQueue(file, 'first');
  await resumed.enqueue([product], term);
  assert.equal(resumed.summary().queued_candidates, 0);
  assert.equal(resumed.unavailable(product), true);
  const next = await createDescriptionQueue(file, 'next');
  assert.equal(next.summary().queued_candidates, 0);
  await next.enqueue([product], term);
  assert.equal(next.cached(product), null);
  const resumedNext = await createDescriptionQueue(file, 'next');
  assert.equal(resumedNext.pending().length, 1);
});

test('one family slot alternates between broad and specific search with a shared cadence', () => {
  const now = Date.parse('2026-11-10T19:00:00Z');
  const family = 'family:helios-neo-16';
  const specific = `${family}:14700hx`;
  const queries = Object.fromEntries(OLX_NOTEBOOK_FAMILIES.map(({id}) =>
    [`notebooks:${id}`, {last_attempt_at: new Date(now - 60_000).toISOString()}]));
  queries[`notebooks:${family}`].last_attempt_at = new Date(now - 25 * 3600_000).toISOString();
  const plan = () => planNotebookFamilies(null, {now, traffic:{queries}});
  assert.deepEqual(plan(), [specific]);
  queries[`notebooks:${specific}`] = {last_attempt_at:new Date(now - 120_000).toISOString()};
  assert.deepEqual(plan(), []);
  queries[`notebooks:${specific}`].last_attempt_at = new Date(now - 24 * 3600_000).toISOString();
  assert.deepEqual(plan(), [family]);
});

const card=(id,title,price=6500,text='')=>({url:`https://sp.olx.com.br/sao-paulo-e-regiao/informatica/notebooks/notebook-${id}`,title,price_brl:price,text,description_discovery:true});
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'notebook-selection-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  return {root,file:path.join(root,'queue.json')};
}
const missing={validation:{state:'pending',description_checked:true,reasons:['CPU não confirmada no anúncio']},ram_gb:32,gpu:'RTX 4060'};

test('recent OLX collection keeps stale family visible without becoming a technical failure',async t=>{
  const {root}=await fixture(t), now=new Date('2026-10-30T19:05:00Z');
  const snapshot={schema_version:2,items:[],run:{started_at:'2026-10-30T19:00:00Z',completed_at:'2026-10-30T19:04:00Z',partial:false,
    configured_coverage:['13980hx','family:rog-strix-g16'],scheduled_coverage:['13980hx'],successful_coverage:['13980hx'],failed_terms:[]},
    coverage_status:{'family:rog-strix-g16':{checked_at:'2026-10-25T19:00:00Z',state:'success'}}};
  const dir=path.join(root,'data','olx');
  await fs.mkdir(dir,{recursive:true});
  await writeJsonAtomic(path.join(dir,'snapshot-2026-10-30T19-04-00-000Z.json'),snapshot);
  const health=await buildMonitorHealth(root,{now}),olx=health.sources.find(s=>s.id==='olx');
  assert.equal(olx.collection_state,'healthy'); assert.equal(olx.coverage_state,'stale'); assert.equal(olx.state,'partial');
  assert.equal(olx.marketplaces.find(m=>m.label==='OLX modelos').state,'stale');
  assert.ok(!collectionHealthAlerts(health).some(a=>a.id==='olx' && a.automatic));
  assert.ok(collectionHealthAlerts(health).some(a=>a.id==='olx-coverage' && !a.automatic));
  const aged=await buildMonitorHealth(root,{now:new Date('2026-11-03T19:05:00Z')});
  assert.ok(collectionHealthAlerts(aged).some(a=>a.id==='olx' && a.automatic));
  snapshot.run.operational={status:'failed'};
  await writeJsonAtomic(path.join(dir,'snapshot-2026-10-30T19-04-00-000Z.json'),snapshot);
  const failed=await buildMonitorHealth(root,{now});
  assert.equal(failed.sources.find(s=>s.id==='olx').collection_state,'failed');
  assert.ok(collectionHealthAlerts(failed).some(a=>a.id==='olx' && a.automatic));
  snapshot.run.operational={status:'blocked'};
  snapshot.run.errors=['Cloudflare bloqueou o acesso; verificação necessária'];
  await writeJsonAtomic(path.join(dir,'snapshot-2026-10-30T19-04-00-000Z.json'),snapshot);
  const blocked=await buildMonitorHealth(root,{now});
  assert.equal(blocked.sources.find(s=>s.id==='olx').collection_state,'blocked');
  assert.equal(blocked.sources.find(s=>s.id==='olx').state,'blocked');
});

test('saved health reconciliation preserves real block errors and actual missing collection',()=>{
  const round={started_at:'2026-10-30T19:00:00Z',completed_at:'2026-10-30T19:05:00Z',sources:[{id:'olx',summary:{execution:'success',collected_at:'2026-10-30T19:04:00Z'}}]};
  assert.deepEqual(reconcileRecordedHealthErrors(round,[LEGACY_OLX_HEALTH_ERROR,'OLED: HTTP 403']),['OLED: HTTP 403']);
  round.sources[0].summary.execution='failed';
  assert.deepEqual(reconcileRecordedHealthErrors(round,[LEGACY_OLX_HEALTH_ERROR]),[LEGACY_OLX_HEALTH_ERROR]);
  round.sources[0].summary.execution='success';round.sources[0].summary.collected_at='2026-10-29T19:04:00Z';
  assert.deepEqual(reconcileRecordedHealthErrors(round,[LEGACY_OLX_HEALTH_ERROR]),[LEGACY_OLX_HEALTH_ERROR]);
});

test('description selection prioritizes affordable configuration evidence before blind first reads',async t=>{
  const {file}=await fixture(t),q=await createDescriptionQueue(file,'rank');
  const weak=card('154000001','Notebook Avell',4500), strong=card('154000002','Notebook i9 13980hx 32GB RAM RTX 4060',7800), costly=card('154000003','Notebook i9 13980hx 64GB RAM RTX 4080',9500);
  await q.enqueue([costly,weak,strong],'family:avell-a65');
  assert.deepEqual(q.pending().map(c=>c.title),[strong.title,weak.title,costly.title]);
  assert.deepEqual(q.prioritize([costly,weak,strong]).map(c=>c.title),[strong.title,weak.title,costly.title]);
  assert.equal(q.summary().above_display_price,1);
});

test('complete but uninformative descriptions wait for a listing change; transient failures remain retryable',()=>{
  assert.deepEqual(descriptionRetryPolicy({detail_attempts:1},missing),{kind:'missing_configuration',hours:null});
  assert.equal(descriptionRetryPolicy({detail_attempts:2},missing).hours,null);
  const transient={validation:{description_checked:false,reasons:['Descrição do anúncio não localizada','CPU não confirmada no anúncio']}};
  assert.deepEqual(descriptionRetryPolicy({detail_attempts:1},transient),{kind:'retryable_read',hours:6});
  assert.equal(descriptionRetryPolicy({detail_attempts:2},transient).hours,24);
});

test('family experiment excludes CPU matches and reads from older queued listings', () => {
  const term = 'family:helios-neo-16:14700hx';
  const rows = {
    '14700hx': {eligible_candidate_ids:['shared'], listing_incomplete:true},
    [term]: {eligible_candidate_ids:['shared','extra','extra'], listing_incomplete:false},
  };
  const reads = {[term]: {read_keys:['extra','old-queue-item']}};
  const first = recordFamilyExperiment({}, rows, 'round', new Set(['extra']), reads);
  const again = recordFamilyExperiment(first, rows, 'round', new Set(['extra']), reads);
  assert.deepEqual(again[term], [{round:'round', candidates:2, additional_candidates:1,
    additional_validated:1, reads:1, cpu_queries:1, partial_listings:true}]);
  const noCpu = recordFamilyExperiment({}, {[term]:rows[term]}, 'round', new Set(), reads);
  assert.equal(noCpu[term][0].additional_candidates, null);
});

test('price labels distinguish filter approval from above, below and insufficient comparables', () => {
  assert.deepEqual(notebookPriceLabels({state:'insufficient_comparables', sample:2}),
    ['Atende aos filtros', 'Comparáveis insuficientes']);
  assert.match(notebookPriceLabels({state:'indicative', sample:3, difference_percent:-5})[1], /acima/);
  assert.match(notebookPriceLabels({state:'indicative', sample:3, difference_percent:5})[1], /abaixo/);
});

test('listing configuration changes reset retries and invalidate cached uncertainty',async t=>{
  const {file}=await fixture(t),q=await createDescriptionQueue(file,'change');
  const original=card('154000004','Notebook Avell',7000);
  await q.enqueue([original],'family:avell-a65');
  await q.remember(original,missing);
  assert.equal(q.pending().length,0);assert.ok(q.cached(original));
  const updated={...original,text:'Processador i9 13980hx, 32GB RAM RTX 4060'};
  await q.enqueue([updated],'family:avell-a65');
  assert.equal(q.pending().length,1); assert.equal(q.cached(updated),null);
  const saved=JSON.parse(await fs.readFile(file,'utf8'));
  assert.equal(saved.queue[0].detail_attempts,0); assert.equal(saved.queue[0].retry_kind,undefined);
});

test('priority uses existing access caps and does not spend requests on expensive items first',async t=>{
  const {file}=await fixture(t),calls=[];
  const q=await createDescriptionQueue(file,'budget',{perTerm:2,perRound:2,reserveAccess:async access=>calls.push(access)});
  const cheap=card('154000005','Notebook 13980hx 32GB RAM',7000), costly=card('154000006','Notebook 13980hx 32GB RAM',9000);
  await q.enqueue([cheap,costly],'family:avell-a65');
  assert.equal(await q.reserveDetail('family:avell-a65',true,costly),false);
  assert.equal(calls.length,0);
  assert.equal(await q.reserveDetail('family:avell-a65',true,cheap),true);
  await q.remember(cheap,{validation:{state:'validated'}});
  assert.equal(await q.reserveDetail('family:avell-a65',true,costly),true);
  assert.equal(await q.reserveDetail('13980hx',true,card('154000007','Notebook 13980hx 32GB RAM')),false);
  assert.equal(calls.length,2);assert.equal(q.summary().extra_details,2);assert.equal(q.summary().per_round_limit,2);
});

test('migration preserves observation timestamps and budgets while pacing old configuration retries',async t=>{
  const {file}=await fixture(t),observed=new Date().toISOString(),attempt=new Date(Date.now()-8*3600_000).toISOString();
  const product=card('154000008','Notebook Avell',6500);
  await fs.writeFile(file,JSON.stringify({round:'same',queue:[{key:'154000008',card:product,terms:['family:avell-a65'],first_observed_at:observed,last_observed_at:observed,
    last_detail_attempt_at:attempt,detail_attempts:1,last_reasons:missing.validation.reasons}],cache:[],metrics:{extra_details:3,total_details:7,by_term:{}}}));
  const q=await createDescriptionQueue(file,'same');await q.save();
  const saved=JSON.parse(await fs.readFile(file,'utf8'));
  assert.equal(saved.queue[0].last_observed_at,observed);assert.equal(saved.queue[0].last_detail_attempt_at,attempt);
  assert.equal(q.summary().total_details,7);assert.equal(q.summary().extra_details,3);
  assert.equal(q.summary().waiting_for_configuration,1);assert.equal(q.pending().length,0);
  assert.equal(saved.queue[0].next_retry_at,undefined);
  assert.equal(q.summary().retry_waiting,0);
});
