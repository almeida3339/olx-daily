import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { collectEnjoeiShoes } from '../scripts/lib/enjoei-shoe-collection.mjs';
import { classifyMonitorOutcome } from '../scripts/lib/monitor-outcome.mjs';
import { buildCollectionSummary, collectionOutcome, roundSummaryLine } from '../scripts/lib/collection-summary.mjs';
import { assessOledMonitor } from '../scripts/lib/oled-monitor-scope.mjs';

const node = (id, title, {price=200,size='42'}={}) => ({id, path:`produto-${id}`, title:{name:title},
  brand:{displayable_name:'FOT'}, price:{current:price}, size:{name:size}});
async function shoeRun(t, pages, details = {}, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'shoe-reliability-'));
  t.after(() => fs.rm(dir,{recursive:true,force:true}));
  const calls = [];
  const fetchImpl = async value => {
    const url = new URL(value); calls.push(url);
    if(url.hostname === 'pages.enjoei.com.br') {
      const id = url.pathname.split('/')[2];
      return {ok:true,json:async()=>({id,...details[id]})};
    }
    const index = Number(url.searchParams.get('after') ?? 0);
    assert.ok(pages[index], `Unexpected page ${index}`);
    return {ok:true,json:async()=>({data:{search:{products:{edges:pages[index].map((n,i)=>({node:n,cursor:`${index}-${i}`})),
      pageInfo:{hasNextPage:true,endCursor:String(index+1)},total:100}}}})};
  };
  const result = await collectEnjoeiShoes({dataDir:dir,terms:['fot'],department:'masculino',shoeSize:'42',
    shippingRange:'all',first:30,maxPriceBrl:500,explicitTerms:true,delayMs:0,fetchImpl,...options});
  return {result,calls,dir};
}

test('secondary incomplete searches cannot report operational success',()=>{
  const run={partial:false,scheduled_coverage:['fiber','fot'],successful_coverage:['fiber'],failed_coverage:['fot'],errors:[]};
  const outcome=classifyMonitorOutcome(run);
  assert.equal(outcome.status,'partial'); assert.equal(outcome.exit_code,2);
  const summary=buildCollectionSummary({items:[],pending_items:[],run},outcome);
  assert.equal(summary.execution,'success'); assert.equal(summary.coverage.status,'partial');
});

test('round totals distinguish incomplete queries from unvalidated candidates',()=>{
  const source={id:'enjoei',summary:{execution:'success',issues:[],coverage:{status:'partial',scheduled:6,completed:5,incomplete:1,pending_candidates:2}}};
  assert.equal(collectionOutcome(source).status,'partial');
  const line=roundSummaryLine({execution:'success',sources:[source]});
  assert.match(line,/Execução concluída/); assert.match(line,/5\/6 consultas completas/);
  assert.match(line,/2 candidatos pendentes/); assert.match(line,/1 consultas incompletas/);
});

test('fot first-page relevance respects size, price and selected models',async t=>{
  for(const product of [node('1','FOT Walka',{size:'41'}),node('2','FOT Walka',{price:501}),node('3','FOT Rudo')]) {
    await t.test(product.title.name+product.id,async t=>{
      const {result,calls}=await shoeRun(t,[[product]]);
      assert.equal(calls.length,1); assert.equal(result.items.length,0);
      assert.equal(result.pagination.fot.stop_reason,'first_page_no_candidate');
      assert.equal(result.pagination.fot.exhaustive,false);
    });
  }
});

test('fot inspects one uncertain model before paginating and rejects excluded models',async t=>{
  const {result,calls}=await shoeRun(t,[[node('1','Tênis FOT')]],{'1':{description:'Modelo Rudo'}});
  assert.equal(calls.length,2); assert.equal(result.stats.details_fetched,1);
  assert.equal(result.items.length,0); assert.equal(result.pendingItems.length,0);
  assert.equal(result.pagination.fot.exhaustive,false);
});

test('fot retains uncertainty as pending instead of deep crawling',async t=>{
  const {result,calls}=await shoeRun(t,[[node('1','Tênis FOT')]],{'1':{description:'Tênis pouco usado'}});
  assert.equal(calls.length,2); assert.equal(result.pendingItems.length,1);
  assert.equal(result.pagination.fot.stop_reason,'first_page_model_pending');
});

test('fot permits selected model discovered in detail but caps discovery at two pages',async t=>{
  const {result,calls}=await shoeRun(t,[[node('1','Tênis FOT')],[node('2','FOT Walka')]],{'1':{description:'Modelo Walka'}});
  assert.equal(calls.filter(url=>url.hostname==='enjusearch.enjoei.com.br').length,2);
  assert.equal(result.stats.details_fetched,1); assert.equal(result.items.length,2);
  assert.equal(result.pagination.fot.stop_reason,'discovery_page_limit');
  assert.equal(result.pagination.fot.complete,true); assert.equal(result.pagination.fot.exhaustive,false);
});

test('AOC exact OLED model is accepted while LCD siblings and defects stay rejected',()=>{
  const item={title:'Monitor AOC Q27G4ZDR',description_evidence:'Monitor completo usado em perfeito estado',price_brl:2500,details_checked_at:new Date().toISOString()};
  assert.equal(assessOledMonitor(item).state,'approved');
  assert.equal(assessOledMonitor({...item,title:'Monitor AOC Q27G4F',description_evidence:'Painel IPS'}).state,'rejected');
  assert.equal(assessOledMonitor({...item,description_evidence:'Com burn-in'}).state,'rejected');
  assert.equal(assessOledMonitor({...item,description_evidence:'',details_checked_at:null}).state,'pending');
});

test('local publisher logs skips, ignores future markers and makes busy exits retryable', {skip:process.platform!=='win32'},async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'publisher-reliability-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const helper=path.resolve('scripts/lib/local-publisher.ps1');
  const quote=value=>`'${value.replaceAll("'","''")}'`;
  const script=path.join(dir,'probe.ps1'), marker=path.join(dir,'marker'), attempt=path.join(dir,'attempt.json');
  await fs.writeFile(script,`. ${quote(helper)}\n$r=Enter-LocalPublisher -Root ${quote(dir)} -Marker ${quote(marker)} -WaitSeconds 0 -BusyCheck { $env:PROBE_BUSY -eq '1' }\n$s=@{}\nWrite-LocalAttempt ${quote(attempt)} $s $r.status $r.reason 'guard'\nif($r.acquired){$r.mutex.ReleaseMutex();$r.mutex.Dispose()}\nWrite-Output ('__RESULT__'+(@{status=$r.status;code=$r.exit_code;acquired=$r.acquired}|ConvertTo-Json -Compress))\n`);
  const probe=busy=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{encoding:'utf8',env:{...process.env,PROBE_BUSY:busy?'1':'0'}}).split('__RESULT__')[1].trim());
  await fs.writeFile(marker,new Date().toISOString());
  assert.equal(probe(false).status,'skipped');
  assert.equal(JSON.parse((await fs.readFile(attempt,'utf8')).replace(/^\uFEFF/, '')).status,'skipped');
  await fs.writeFile(marker,new Date(Date.now()+86400000).toISOString());
  assert.equal(probe(false).acquired,true);
  assert.deepEqual(probe(true),{code:1,acquired:false,status:'deferred'});
});

test('actual local wrapper writes transcript and structured attempt even on cooldown skip',{skip:process.platform!=='win32'},async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'local-wrapper-reliability-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.mkdir(path.join(dir,'scripts','lib'),{recursive:true});
  await fs.copyFile('scripts/run-local-olx-and-publish.ps1',path.join(dir,'scripts','run.ps1'));
  await fs.copyFile('scripts/lib/local-publisher.ps1',path.join(dir,'scripts','lib','local-publisher.ps1'));
  await fs.writeFile(path.join(dir,'.monitor-olx-enjoei-last-run'),new Date().toISOString());
  execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(dir,'scripts','run.ps1')],
    {env:{...process.env,USERPROFILE:dir},stdio:'pipe'});
  const names=await fs.readdir(path.join(dir,'logs'));
  assert.ok(names.some(name=>name.endsWith('.log')));
  const attempt=JSON.parse((await fs.readFile(path.join(dir,'logs',names.find(name=>name.endsWith('.json'))),'utf8')).replace(/^\uFEFF/,''));
  assert.equal(attempt.status,'skipped'); assert.match(attempt.reason,/Cooldown/);
  assert.equal(attempt.published,false);
});
