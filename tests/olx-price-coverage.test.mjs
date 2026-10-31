import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createDescriptionQueue} from '../scripts/lib/olx-description-queue.mjs';
import {buildOlxPriceCoverage,olxPriceCoverageLines} from '../scripts/lib/olx-price-coverage.mjs';
import {buildCollectionSummary,collectionSummaryLine,roundSummaryLine} from '../scripts/lib/collection-summary.mjs';

const card=(id,term='family:helios-neo-16',price=7000)=>({url:`https://sp.olx.com.br/sao-paulo-e-regiao/informatica/notebooks/notebook-${id}`,title:'Notebook 13980hx 32GB RAM RTX 4060',price_brl:price,cpu_term:term,description_discovery:true});
async function queueFixture(t,{cards=[card('155000001'),card('155000002')],metrics={},perRound=8,reserveAccess=async()=>{}}={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spare-description-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'queue.json'),now=new Date().toISOString();
  await fs.writeFile(file,JSON.stringify({round:'replay',cache:[],queue:cards.map(c=>({key:c.url.match(/\d+$/)[0],card:c,terms:[c.cpu_term],first_observed_at:now,last_observed_at:now})),
    metrics:{extra_details:7,total_details:9,by_term:{'family:helios-neo-16':4,'family:avell-storm':2,'family:rog-strix-g16':1},...metrics}}));
  return createDescriptionQueue(file,'replay',{perRound,reserveAccess});
}

test('one spare family slot is available only in final pass within both total caps',async t=>{
  const calls=[],q=await queueFixture(t,{reserveAccess:async x=>calls.push(x)}),[first,second]=q.pending();
  assert.equal(await q.reserveDetail(first.cpu_term,true,first,{finishRound:true,allowReallocation:false}),false);
  assert.equal(await q.reserveDetail(first.cpu_term,true,first),false);
  assert.equal(await q.reserveDetail(first.cpu_term,true,first,{finishRound:true}),true);
  assert.equal(await q.reserveDetail(second.cpu_term,true,second,{finishRound:true}),false);
  assert.equal(calls.length,1);assert.equal(q.summary().extra_details,8);assert.equal(q.summary().total_details,10);
  assert.equal(q.summary().reallocated_details,1);
});

test('ready alternative family is served before lending a slot',async t=>{
  const first=card('155000003'),other=card('155000004','family:avell-storm',6500);
  const q=await queueFixture(t,{cards:[first,other],metrics:{extra_details:6,total_details:8}});
  assert.equal(await q.reserveDetail(first.cpu_term,true,first,{finishRound:true}),false);
  assert.equal(await q.reserveDetail(other.cpu_term,true,other,{finishRound:true,allowReallocation:false}),true);
  await q.remember(other,{validation:{state:'validated'}});
  assert.equal(await q.reserveDetail(first.cpu_term,true,first,{finishRound:true}),true);
  assert.equal(q.summary().extra_details,8);
});

test('reallocation remains one per round and cannot bypass price or global access limits',async t=>{
  const a=card('155000005'),b=card('155000006','family:avell-storm'),expensive=card('155000007','family:helios-neo-16',9000);
  const q=await queueFixture(t,{cards:[a,b,expensive],perRound:10,metrics:{by_term:{'family:helios-neo-16':4,'family:avell-storm':4}}});
  assert.equal(await q.reserveDetail(expensive.cpu_term,true,expensive,{finishRound:true}),false);
  assert.equal(await q.reserveDetail(a.cpu_term,true,a,{finishRound:true}),true);
  assert.equal(await q.reserveDetail(b.cpu_term,true,b,{finishRound:true}),false);
  const full=await queueFixture(t,{metrics:{total_details:12}});
  assert.equal(await full.reserveDetail(a.cpu_term,true,a,{finishRound:true}),false);
  const deferred=await queueFixture(t,{reserveAccess:async()=>{const e=Error('Daily budget reached');e.kind='deferred';throw e;}});
  assert.equal(await deferred.reserveDetail(a.cpu_term,true,a,{finishRound:true}),false);
  assert.equal(deferred.summary().extra_details,7);assert.equal(deferred.summary().reallocated_details,undefined);
});

function snapshotFixture(){
  const terms=['14700hx','13980hx','14900hx','13900hx','family:rog-strix-g16'];
  const pendingItem=(term,price)=>({id:`${term}-${price}`,status:'active',cpu_term:term,price_brl:price,
    validation:{state:'pending',checked_at:'2026-10-31T10:01:00Z',reasons:['Ficha aguardando leitura dentro dos limites da rodada']}});
  return {items:[pendingItem('14700hx',8999),pendingItem('14700hx',9500),pendingItem('14900hx',8900),pendingItem('14900hx',9400)],
    run:{started_at:'2026-10-31T10:00:00Z',completed_at:'2026-10-31T10:03:00Z',scheduled_coverage:terms,successful_coverage:['13980hx','13900hx'],
      failed_terms:terms.filter(t=>!['13980hx','13900hx'].includes(t)).map(term=>({term,kind:'incomplete'})),
      description_discovery:{queued_candidates:17,above_display_price:4},query_yield:Object.fromEntries(terms.map(term=>[term,
        {listing_incomplete:term.startsWith('family:'),details_pending:['14700hx','14900hx'].includes(term)?2:0}]))}};
}

test('legacy OLX evidence splits four expensive pending details from offer coverage without hiding truncation',()=>{
  const snapshot=snapshotFixture(),coverage=buildOlxPriceCoverage(snapshot);
  assert.equal(coverage.offers.completed,4);assert.equal(coverage.offers.scheduled,5);
  assert.equal(coverage.offers.incomplete,1);assert.equal(coverage.offers.pending_details,0);
  assert.deepEqual(coverage.offers.incomplete_terms,['family:rog-strix-g16']);
  assert.equal(coverage.tracking.pending_details,4);assert.equal(coverage.tracking.scheduled,2);
  assert.equal(coverage.tracking.completed,0);assert.equal(coverage.offers.queued_candidates,13);
  assert.equal(snapshot.run.successful_coverage.length,2,'original total completeness must remain unchanged');
});

test('in-budget pending details and unclassified failures never become complete offers',()=>{
  const s=snapshotFixture();s.items[0].price_brl=7999;
  let coverage=buildOlxPriceCoverage(s);
  assert.equal(coverage.offers.completed,3);assert.equal(coverage.offers.pending_details,1);
  s.items=s.items.slice(1);
  coverage=buildOlxPriceCoverage(s);
  assert.ok(coverage.offers.incomplete_terms.includes('14700hx'),'missing split evidence must remain incomplete');
  s.run.failed_terms[1].kind='challenge';
  coverage=buildOlxPriceCoverage(s);
  assert.ok(coverage.offers.incomplete_terms.includes('14900hx'));
});

test('explicit new collection facts and shared messages distinguish price scopes',()=>{
  const snapshot=snapshotFixture();
  snapshot.run.query_yield['14700hx'].details_pending_offers=0;
  snapshot.run.query_yield['14700hx'].details_pending_tracking=2;
  const summary=buildCollectionSummary(snapshot,{status:'partial',reasons:[]}),source={id:'olx',label:'OLX Notebooks',summary};
  assert.equal(summary.coverage.completed,2);
  assert.equal(summary.coverage.price_scopes.offers.completed,4);
  const line=collectionSummaryLine(source);
  assert.match(line,/Ofertas até R\$ 8\.000: 4\/5/);
  assert.match(line,/Acompanhamento acima de R\$ 8\.000 até R\$ 10\.000: 4 fichas/);
  assert.match(roundSummaryLine({execution:'success',sources:[source]}),/ofertas OLX: 4\/5/);
  assert.equal(olxPriceCoverageLines(summary.coverage.price_scopes).length,2);
});

test('a successful final queue read clears its price-scope backlog without changing the original query history',()=>{
  const s=snapshotFixture();
  s.run.query_yield['14700hx']={listing_incomplete:false,details_pending:1,pending_detail_keys:{offers:['resolved'],tracking:[]}};
  s.items.push({id:'resolved',status:'active',cpu_term:'14700hx',price_brl:7000,
    validation:{state:'pending',description_checked:true,checked_at:'2026-10-31T10:02:00Z',reasons:['CPU não confirmada no anúncio']}});
  let coverage=buildOlxPriceCoverage(s);
  assert.ok(coverage.offers.completed_terms.includes('14700hx'));
  assert.equal(coverage.offers.pending_details,0);
  assert.ok(coverage.offers.pending_candidates>0,'a read is not an approval');
  s.items.at(-1).validation.description_checked=false;
  coverage=buildOlxPriceCoverage(s);
  assert.ok(coverage.offers.incomplete_terms.includes('14700hx'));
  assert.equal(coverage.offers.pending_details,1,'an unreadable body remains pending');
});
