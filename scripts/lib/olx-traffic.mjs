import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJsonAtomic } from './monitor-runtime.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const stateFile=()=>process.env.OLX_TRAFFIC_STATE_FILE??path.join(root,'data/status/olx-traffic.json');
const dayKey=date=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const limit=(name,fallback)=>{const n=Number(process.env[name]??fallback);if(!Number.isFinite(n)||n<0)throw Error(`Limite OLX inválido: ${name}`);return Math.floor(n);};
export function olxTrafficLimits(){return {
  daily:{search:limit('OLX_DAILY_SEARCH_LIMIT',40),detail:limit('OLX_DAILY_DETAIL_LIMIT',24)},
  round:{search:limit('OLX_ROUND_SEARCH_LIMIT',22),detail:limit('OLX_ROUND_DETAIL_LIMIT',14)},
};}
export class OlxDeferredError extends Error {
  constructor(message){super(message);this.kind='deferred';this.name='OlxDeferredError';}
}
export function olxIntervalHours(watchlist,query,record={}) {
  if(watchlist==='notebooks'&&['14700hx','13980hx','14900hx','13900hx'].includes(query))return 8;
  if(record.approved>0||Date.now()-Date.parse(record.last_change_at??'')<7*86400_000)return 8;
  const base=24;
  return (record.empty_runs??0)>=6?72:(record.empty_runs??0)>=3?48:base;
}
async function withState(operation) {
  const file=stateFile(),lock=`${file}.monitor.lock`;
  await fs.mkdir(path.dirname(file),{recursive:true});
  let handle;
  const until=Date.now()+5000;
  while(!handle){
    try{handle=await fs.open(lock,'wx');await handle.writeFile(JSON.stringify({pid:process.pid}));}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const info=await fs.readFile(lock,'utf8').catch(()=>null);
      let owner;try{owner=JSON.parse(info)?.pid;}catch{}
      let alive=true;
      if(owner){try{process.kill(owner,0);}catch(e){alive=e.code!=='ESRCH';}}
      else{const stat=await fs.stat(lock).catch(()=>null);alive=!stat||Date.now()-stat.mtimeMs<5000;}
      if(!alive){await fs.unlink(lock).catch(()=>{});continue;}
      if(Date.now()>until)throw Error('Não foi possível obter a trava do orçamento OLX');
      await new Promise(resolve=>setTimeout(resolve,50));
    }
  }
  try{
    let state;
    try{state=JSON.parse(await fs.readFile(file,'utf8'));}
    catch(error){if(error.code!=='ENOENT')throw error;state={schema_version:1,tracking_started_at:new Date().toISOString(),days:{},queries:{}};}
    if(state.schema_version!==1||!state.days||!state.queries)throw Error('Estado do orçamento OLX inválido');
    const result=await operation(state);
    state.updated_at=new Date().toISOString();state.limits=olxTrafficLimits();
    const dates=Object.keys(state.days).sort().slice(-14);
    state.days=Object.fromEntries(dates.map(date=>[date,state.days[date]]));
    await writeJsonAtomic(file,state,{validate:null});
    return result;
  }finally{await handle.close();await fs.unlink(lock).catch(()=>{});}
}
export async function reserveOlxAccess({watchlist,query,kind,force=false,retry=false}) {
  if(!['search','detail'].includes(kind))throw Error('Tipo de acesso OLX inválido');
  const result=await withState(state=>{
    const now=new Date(),day=dayKey(now),limits=olxTrafficLimits();
    const run=process.env.OLX_TRAFFIC_RUN_ID??`standalone-${process.pid}`;
    const usage=state.days[day]??={search:0,detail:0,watchlists:{},rounds:{}};
    const round=usage.rounds[run]??={search:0,detail:0};
    const key=`${watchlist}:${query}`,record=state.queries[key]??={};
    if(kind==='search'&&!force&&!retry&&Date.now()-Date.parse(record.last_attempt_at??'')<olxIntervalHours(watchlist,query,record)*3600_000)
      return {denied:`OLX ${watchlist}/${query}: consulta adiada pela frequência de ${olxIntervalHours(watchlist,query,record)}h`};
    if(usage[kind]>=limits.daily[kind]||round[kind]>=limits.round[kind])
      return {denied:`OLX: orçamento ${kind==='search'?'de buscas':'de fichas'} atingido (${usage[kind]}/${limits.daily[kind]} no dia; ${round[kind]}/${limits.round[kind]} na rodada)`};
    usage[kind]++;round[kind]++;
    const source=usage.watchlists[watchlist]??={search:0,detail:0};source[kind]++;
    if(kind==='search')record.last_attempt_at=now.toISOString();
    return {day,kind,used:usage[kind],limit:limits.daily[kind]};
  });
  if(result.denied)throw new OlxDeferredError(result.denied);
  return result;
}
export async function recordOlxYield(watchlist,query,{items=[],complete=false,blocked=false}={}) {
  await withState(state=>{
    const key=`${watchlist}:${query}`,record=state.queries[key]??={};
    const prices=Object.fromEntries(items.slice(0,100).map(item=>[item.id??item.url,Number(item.price_brl)]));
    const changed=Object.entries(prices).some(([id,price])=>record.prices?.[id]!==price);
    record.approved=items.length;
    if(changed)record.last_change_at=new Date().toISOString();
    if(complete){record.last_success_at=new Date().toISOString();record.empty_runs=items.length?0:(record.empty_runs??0)+1;record.prices=prices;}
    if(blocked)record.blocked_at=new Date().toISOString();
    record.interval_hours=olxIntervalHours(watchlist,query,record);
  });
}
export async function readOlxTraffic(){
  try{return JSON.parse(await fs.readFile(stateFile(),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
export async function initializeOlxTraffic(){return withState(()=>null);}
