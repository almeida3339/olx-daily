import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {olxNotebookListingLimit} from '../scripts/lib/olx-listing-limit.mjs';
import {inEnjoeiCiWindow,staleEnjoeiJobs,ENJOEI_RECOVERY_JOBS} from '../scripts/lib/enjoei-recovery.mjs';
import {getWatchlist} from '../scripts/lib/watchlists-registry.mjs';
import {readOlxDetailUntilReady,olxDetailDiagnostic} from '../scripts/lib/olx-detail-diagnostics.mjs';
import {validateOlxNotebook} from '../scripts/lib/olx-notebook-quality.mjs';
import {httpResponseError} from '../scripts/lib/http-diagnostics.mjs';
import {classifyMonitorError} from '../scripts/lib/monitor-errors.mjs';
import {collectEnjoeiShoes} from '../scripts/lib/enjoei-shoe-collection.mjs';

test('adaptive OLX limit keeps the learned floor across complete runs and rotating terms',()=>{
  let limit=olxNotebookListingLimit('14700hx',12,{listing_limit:12,listing_incomplete:true});
  assert.equal(limit,36);
  for(let i=0;i<3;i++) limit=olxNotebookListingLimit('14700hx',12,{listing_limit:limit,listing_incomplete:false});
  assert.equal(limit,36);
  assert.equal(olxNotebookListingLimit('14700hx',12,{}, {listing_limit:36,listing_incomplete:false}),36);
  assert.equal(olxNotebookListingLimit('14700hx',12,{listing_limit:12,listing_incomplete:false},{listing_limit:36}),36);
  assert.equal(olxNotebookListingLimit('14700hx',12,{listing_limit:36,listing_incomplete:true}),60);
  assert.equal(olxNotebookListingLimit('14700hx',12,{listing_limit:60,listing_incomplete:true}),60);
  assert.equal(olxNotebookListingLimit('family:rog',12,{listing_limit:60,listing_incomplete:true}),90);
  assert.equal(olxNotebookListingLimit('family:rog',12,{listing_limit:90,listing_incomplete:false}),90);
  assert.equal(olxNotebookListingLimit('275hx',12),12);
  assert.equal(olxNotebookListingLimit('14900hx',12),36);
});

test('recovery grace covers dispatch delay at both observed GitHub schedule times',()=>{
  for(const time of ['10:58:00','11:00:03','11:19:59','18:58:00','19:00:10','19:19:59'])
    assert.equal(inEnjoeiCiWindow(Date.parse(`2026-11-01T${time}Z`)),true,time);
  for(const time of ['10:57:59','11:20:00','19:20:00','10:00:03'])
    assert.equal(inEnjoeiCiWindow(Date.parse(`2026-11-01T${time}Z`)),false,time);
});

const failedCi={id:41299921973,status:'completed',conclusion:'failure',created_at:'2026-11-01T11:00:18Z',run_started_at:'2026-11-01T11:00:18Z'};
async function recoveryFixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'enjoei-coordination-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const ids=ENJOEI_RECOVERY_JOBS.flatMap(job=>job.ids),restore=[];
  for(const id of ids){
    const dir=path.join(root,'data',getWatchlist(id).repoFolder),key=getWatchlist(id).env;
    restore.push([key,process.env[key]]);process.env[key]=dir;
    await fs.mkdir(dir,{recursive:true});
    await fs.writeFile(path.join(dir,'snapshot-2026-11-01T11-01-20-000Z.json'),JSON.stringify({schema_version:2,generated_at:'2026-11-01T11:01:20Z',items:[],coverage_status:{},
      run:{started_at:'2026-11-01T11:01:15Z',completed_at:'2026-11-01T11:01:20Z',errors:id==='enjoei'?['HTTP 422']:[],operational:{status:id==='enjoei'?'failed':'success'}}}));
  }
  t.after(()=>{for(const [key,value] of restore)if(value===undefined)delete process.env[key];else process.env[key]=value;});
  const ciStatus={round_summary:{started_at:'2026-11-01T11:01:15Z',completed_at:'2026-11-01T11:01:27Z',sources:ids.map(id=>({id,summary:{execution:id==='enjoei'?'failed':'success'}}))}};
  return {root,ciStatus};
}

test('recovery skips dispatch window and running CI without querying individual sources',async t=>{
  const {root,ciStatus}=await recoveryFixture(t);
  assert.deepEqual(await staleEnjoeiJobs(root,{now:Date.parse('2026-11-01T19:00:10Z'),ciRun:failedCi,ciStatus}),[]);
  assert.deepEqual(await staleEnjoeiJobs(root,{now:Date.parse('2026-11-01T19:30:00Z'),ciRun:{...failedCi,status:'in_progress'},ciStatus}),[]);
});

test('a failed workflow recovers only the failed source and does not repeat a successful recovery',async t=>{
  const {root,ciStatus}=await recoveryFixture(t),options={now:Date.parse('2026-11-01T19:30:00Z'),ciRun:failedCi,ciStatus};
  assert.deepEqual((await staleEnjoeiJobs(root,options)).map(job=>job.ids),[['enjoei']]);
  const dir=path.join(root,'data','enjoei');
  await fs.writeFile(path.join(dir,'snapshot-2026-11-01T19-29-00-000Z.json'),JSON.stringify({schema_version:2,generated_at:'2026-11-01T19:29:00Z',items:[],coverage_status:{},run:{completed_at:'2026-11-01T19:29:00Z',operational:{status:'success'},errors:[]}}));
  assert.deepEqual(await staleEnjoeiJobs(root,options),[]);
});

test('missing CI status still detects per-monitor failure from fresh snapshot',async t=>{
  const {root}=await recoveryFixture(t);
  assert.deepEqual((await staleEnjoeiJobs(root,{now:Date.parse('2026-11-01T19:30:00Z'),ciRun:failedCi,ciStatus:null})).map(job=>job.ids),[['enjoei']]);
});

test('36-hour fallback remains available outside dispatch windows when GitHub is unavailable',async t=>{
  const {root}=await recoveryFixture(t);
  const jobs=await staleEnjoeiJobs(root,{now:Date.parse('2026-11-03T10:00:00Z'),ciRun:null,ciStatus:null});
  assert.equal(jobs.length,7);assert.ok(jobs.every(job=>job.failed_workflow_id===null));
});

const url='https://sp.olx.com.br/informatica/notebooks/notebook-1540000001';
const ready={url,title:'Notebook i9 13980hx 32gb RAM RTX 4060',description:'Memória RAM 32gb, CPU i9 13980hx, RTX 4060.',structured_price:7000,body_text:'Página do anúncio',document_state:'complete',structured_product_found:true,description_source:'structured'};
test('detail reader waits for ad fields even when recommendation body is already large',async()=>{
  let time=0,reads=0;
  const detail=await readOlxDetailUntilReady(async()=>++reads===1?{...ready,description:'',structured_price:null,body_text:'Recomendações '.repeat(100)}:ready,
    {cardUrl:url,now:()=>time,sleep:async ms=>{time+=ms;}});
  assert.equal(reads,2);assert.equal(detail.wait_ms,500);assert.equal(detail.diagnostic.state,'ready');
  const item=validateOlxNotebook({title:ready.title,url,price_brl:7000,cpu_term:'13980hx'},detail);
  assert.equal(item.validation.state,'validated');assert.equal(item.validation.detail_diagnostic.same_ad,true);
});

test('detail timeout persists missing-field diagnostic and cannot approve a listing-only configuration',async()=>{
  let time=0;
  const detail=await readOlxDetailUntilReady(async()=>({...ready,description:'',structured_price:null}),
    {cardUrl:url,timeoutMs:1000,now:()=>time,sleep:async ms=>{time+=ms;}});
  assert.equal(detail.wait_ms,1000);assert.equal(detail.diagnostic.state,'missing_ad_fields');
  assert.equal(detail.samples,3);
  const item=validateOlxNotebook({title:ready.title,url,price_brl:7000,cpu_term:'13980hx'},detail);
  assert.equal(item.validation.state,'pending');assert.equal(item.validation.detail_diagnostic.description_found,false);
});

test('detail polling stops on unavailable, wrong ad, login and blocking states',async()=>{
  assert.equal(olxDetailDiagnostic({...ready,url:url.replace('1540000001','1540000002')},url).state,'wrong_ad');
  const detail=await readOlxDetailUntilReady(async()=>({...ready,http_status:404}),{cardUrl:url});
  assert.equal(detail.samples,1);assert.equal(detail.diagnostic.state,'unavailable');
  assert.equal(validateOlxNotebook({title:ready.title,url,price_brl:7000,cpu_term:'13980hx'},detail).validation.state,'pending');
  for(const [extra,state] of [[{body_text:'Sorry, you have been blocked'},'challenge'],[{http_status:403},'challenge'],[{http_status:429},'limited'],[{url:'https://www.olx.com.br/login'},'logged_out']]){
    let reads=0;
    await assert.rejects(()=>readOlxDetailUntilReady(async()=>{reads++;return {...ready,...extra};}),e=>e.pageState===state);
    assert.equal(reads,1);
  }
});

test('HTTP diagnostics retain error category and request reference without echoing secrets or request values',async()=>{
  const body=JSON.stringify({errors:[{message:'Invalid cursor after: secret-cursor for email=user@example.com token=supersecret',extensions:{code:'INVALID_CURSOR'}}],phone:'11999999999'});
  const error=await httpResponseError(new Response(body,{status:422,headers:{'content-type':'application/json','x-request-id':'req-123','set-cookie':'secret-session'}}));
  assert.equal(error.http_diagnostic.category,'invalid_cursor');assert.deepEqual(error.http_diagnostic.codes,['INVALID_CURSOR']);
  assert.deepEqual(error.http_diagnostic.fields,['after']);assert.equal(error.http_diagnostic.request_id,'req-123');
  assert.match(error.message,/HTTP 422/);assert.doesNotMatch(error.message,/secret-cursor|user@|supersecret|999999|secret-session/);
  assert.equal(classifyMonitorError(error).kind,'validation');
  assert.equal(classifyMonitorError(await httpResponseError(new Response('{"message":"Service unavailable"}',{status:503,headers:{'content-type':'application/json'}}))).kind,'transient');
});

test('HTTP diagnostic error-body inspection is capped and safe for HTML denial pages',async()=>{
  const error=await httpResponseError(new Response('<html>Cloudflare verify you are human '+ 'a'.repeat(10000),{status:403,headers:{'content-type':'text/html'}}));
  assert.equal(error.http_diagnostic.category,'verification_required');assert.equal(error.http_diagnostic.response_kind,'html');
  assert.ok(error.message.length<700);assert.equal(error.http_diagnostic.body_fingerprint.length,16);
});

test('shoe collector persists 422 diagnostic, keeps term failed and does not retry blindly',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'enjoei-http-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));let calls=0;
  const result=await collectEnjoeiShoes({dataDir:dir,terms:['feet of tomorrow'],explicitTerms:true,department:'masculino',shoeSize:'42',shippingRange:'same_country',state:'pr',city:'curitiba',delayMs:0,
    fetchImpl:async()=>{calls++;return new Response('{"message":"Invalid argument term","code":"INVALID_ARGUMENT"}',{status:422,headers:{'content-type':'application/json'}});}});
  assert.equal(calls,1);assert.deepEqual(result.failedTerms,['feet of tomorrow']);
  const progress=JSON.parse(await fs.readFile(path.join(dir,'collection-progress.json'),'utf8'));
  assert.match(progress.terms['feet of tomorrow'].request_error,/INVALID_ARGUMENT/);
  assert.equal(progress.terms['feet of tomorrow'].complete,false);
});
