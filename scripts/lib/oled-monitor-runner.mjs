import { setMonitorExit } from './monitor-outcome.mjs';
import { reserveOlxAccess, readOlxTraffic } from './olx-traffic.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectOlx } from './watchlist-monitor.mjs';
import { collectEnjoeiPages } from './enjoei-pagination.mjs';
import { mergeMonitorSnapshot, buildMonitorChanges } from './monitor-core.mjs';
import { commitMonitorRun, readLatestValidSnapshot, writeJsonAtomic } from './monitor-runtime.mjs';
import { classifyMonitorError } from './monitor-errors.mjs';
import { readOlxNotebookDetail, assertOlxAccessible } from './olx-notebook-quality.mjs';
import { parseBrlPrice, extractOlxId } from './parsers.mjs';
import { OLED_PRICE, OLED_POLICY_VERSION, OLED_DETAIL_TTL_MS, assessOledMonitor, isCompleteOledMonitor,
  isApprovedOledMonitor, hasApprovedOledEvidence, classifySavedOledItem, normalizeOledSearchTerm, oledPendingReason } from './oled-monitor-scope.mjs';
import { oledQuerySpecs, planOledQueries } from './oled-search-plan.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const readState=async file=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;return {};}};
const key=item=>`${item.source}:${item.id}`;
const nowIso=()=>new Date().toISOString();

export async function runOledMonitor({ root, dataDir }) {
  await fs.mkdir(dataDir,{recursive:true});
  const lockFile=path.join(dataDir,'.oled-collection.monitor.lock');
  let handle;
  try { handle=await fs.open(lockFile,'wx'); }
  catch(error){
    if(error.code!=='EEXIST')throw error;
    const lock=await readState(lockFile);let alive=false;
    try{process.kill(lock.pid,0);alive=true;}catch{}
    if(alive)throw Error('Já existe uma coleta OLED em andamento.');
    await fs.unlink(lockFile);handle=await fs.open(lockFile,'wx');
  }
  try {
    await handle.writeFile(JSON.stringify({pid:process.pid,started_at:nowIso()}));await handle.close();
    await collect({root,dataDir});
  } finally {await handle?.close().catch(()=>{});await fs.unlink(lockFile).catch(()=>{});}
}

async function collect({ root,dataDir }) {
  const started=nowIso(), args=process.argv.slice(2), fullSweep=args.includes('--full-sweep');
  const explicitValue=args.findIndex(a=>a==='--terms'||a==='--models');
  const explicit=explicitValue>=0?String(args[explicitValue+1]??'').split(',').map(normalizeOledSearchTerm).filter(Boolean):null;
  if(explicit?.some(q=>!oledQuerySpecs('OLX').some(s=>s.id===q)))throw Error('Consulta OLED desconhecida; use um termo do catálogo compartilhado.');
  const {snapshot:previous}=await readLatestValidSnapshot(dataDir);
  const statePath=path.join(dataDir,'oled-search-state.json'), state=await readState(statePath);
  state.version=OLED_POLICY_VERSION;state.queries??={};state.cache??={};state.pending??={};
  const collected=new Map(), failed=new Map(), scheduled=[], deferred=[], success=[], metrics={}, blocks={...(previous?.source_blocks??{})};
  const save=async()=>{
    state.updated_at=nowIso();
    state.cache=Object.fromEntries(Object.entries(state.cache).filter(([,v])=>Date.now()-Date.parse(v.checked_at)<OLED_DETAIL_TTL_MS).slice(-500));
    state.pending=Object.fromEntries(Object.entries(state.pending).filter(([,v])=>Date.now()-Date.parse(v.last_observed_at)<7*86400_000).slice(-500));
    await writeJsonAtomic(statePath,state,{validate:null});
  };
  const coverage={...(previous?.coverage_status??{})};
  const configured=['OLX','Enjoei'].flatMap(source=>oledQuerySpecs(source).map(s=>`${source}:${s.id}`));
  const skipEnjoei=args.includes('--skip-enjoei')||process.env.SKIP_ENJOEI==='1';
  const skipOlx=args.includes('--skip-olx')||process.env.SKIP_OLX==='1';
  const count={OLX:{search_requests:0,detail_reads:0,cache_hits:0},Enjoei:{search_requests:0,detail_reads:0,cache_hits:0}};
  const budgets={OLX:{details:6,cards:60},Enjoei:{pages:8,details:4}};
  const checkpointItem=async(item)=>{
    collected.set(key(item),item);
    if(item.oled_validation.state==='pending')state.pending[key(item)]={...item,last_observed_at:nowIso()};
    else delete state.pending[key(item)];
    await save();return item;
  };
  async function resolveItem(item,openDetail) {
    const source=item.source,k=key(item), cached=state.cache[k];
    const reusable=cached?.version===OLED_POLICY_VERSION&&cached.title===item.title&&cached.price_brl===item.price_brl
      &&Date.now()-Date.parse(cached.checked_at)<OLED_DETAIL_TTL_MS;
    if(reusable){count[source].cache_hits++;item={...item,...cached.evidence};}
    else if(count[source].detail_reads<budgets[source].details) {
      if(source==='OLX'){
        try{await reserveOlxAccess({watchlist:'oled-monitores',query:item.term,kind:'detail'});}
        catch(error){if(error.kind!=='deferred')throw error;item.detail_error=error.message;item.oled_validation={...assessOledMonitor(item),state:'pending',reasons:[error.message]};return checkpointItem(item);}
      }
      count[source].detail_reads++; await save();
      try{
        const detail=await openDetail();
        item={...item,...detail};
        delete item.detail_error;
        state.cache[k]={version:OLED_POLICY_VERSION,title:item.listing_title??item.title,price_brl:item.price_brl,checked_at:nowIso(),
          evidence:{description_evidence:item.description_evidence,detail_title:item.detail_title,details_checked_at:item.details_checked_at,
            identity_error:item.identity_error,price_error:item.price_error}};
      }catch(error){
        if(['challenge','authentication','rate_limited'].includes(classifyMonitorError(error).kind))throw error;
        item.detail_error=error.message;
      }
    }
    item.oled_validation=assessOledMonitor(item);
    if(item.detail_error)item.oled_validation={...item.oled_validation,state:'pending',reasons:[...item.oled_validation.reasons,item.detail_error]};
    return checkpointItem(item);
  }
  async function finishQuery(source,spec,complete,error=null,raw={}) {
    const id=`${source}:${spec.id}`;
    const hits=[...collected.values()].filter(item=>item.search_terms?.includes(id));
    metrics[id]={...raw,approved:hits.filter(isApprovedOledMonitor).length,pending:hits.filter(i=>i.oled_validation.state==='pending').length,
      rejected:hits.filter(i=>i.oled_validation.state==='rejected').length,exclusive:hits.filter(i=>isApprovedOledMonitor(i)&&i.search_terms.length===1).length};
    // Only unread/failed details prevent completion; reviewed ambiguities are
    // visible manual candidates, not an infinite automatic retry cycle.
    const unread=hits.some(item=>item.oled_validation.state==='pending'&&(!item.details_checked_at||item.detail_error));
    if(complete&&!unread)success.push(id);else failed.set(id,error??(unread?'Ficha pendente de leitura':'Cobertura incompleta'));
    coverage[id]={checked_at:nowIso(),last_success_at:complete&&!unread?nowIso():coverage[id]?.last_success_at??null,state:complete&&!unread?'success':'failed',error:failed.get(id)??null};
    await save();
  }

  if(!skipEnjoei) {
    const plan=planOledQueries('Enjoei',coverage,{fullSweep,explicit});
    for(const spec of plan) {
      const id=`Enjoei:${spec.id}`, old=coverage[id];
      // A published CI collection also satisfies a local run in the same slot.
      const staleOffer=previous?.items?.some(item=>item.source==='Enjoei' && item.search_terms?.includes(id)
        && assessOledMonitor(item).state==='approved' && oledPendingReason(item));
      if(!fullSweep&&!explicit&&!staleOffer&&old?.state==='success'&&Date.now()-Date.parse(old.last_success_at)<12*3600_000)continue;
      scheduled.push(id);const before=count.Enjoei.search_requests;
      let cursor=state.queries[id];
      if(!cursor||cursor.complete||Date.now()-Date.parse(cursor.started_at)>7*86400_000)cursor=state.queries[id]={after:null,pages:0,complete:false,seen_ids:[],started_at:nowIso()};
      console.log(`Enjoei OLED: ${spec.query}`);
      try {
        const result=await collectEnjoeiPages({progress:cursor,maxPages:Math.max(0,budgets.Enjoei.pages-count.Enjoei.search_requests),deadline:Date.now()+90_000,checkpoint:save,
          fetchPage:async after=>{
            count.Enjoei.search_requests++;
            const url=new URL('https://enjusearch.enjoei.com.br/graphql-search-x');
            for(const [name,value] of Object.entries({first:'30',operation_name:'searchProducts',query_id:'c5faa5f85fb47bf0beaa97b67d8a9189',
              search_context:'products_search',shipping_range:'same_country',experienced_seller:'true',term:spec.query,browser_id:'oled-monitor',search_id:'oled-monitor'}))url.searchParams.set(name,value);
            if(after!=null)url.searchParams.set('after',after);
            const response=await fetch(url,{headers:{accept:'application/json',origin:'https://www.enjoei.com.br'},signal:AbortSignal.timeout(15000)});
            if(!response.ok)throw Error(`HTTP ${response.status}`);
            const payload=await response.json(),p=payload.data?.search?.products;
            if(payload.errors?.length||!Array.isArray(p?.edges))throw Error('Resposta Enjoei sem produtos válidos');
            const ids=new Set([...(cursor.seen_ids??[]),...p.edges.filter(e=>e.node?.id!=null).map(e=>String(e.node.id))]);
            if(Number(p.total)>0&&ids.size>=Number(p.total))p.pageInfo={...p.pageInfo,hasNextPage:false};
            return p;
          },onPage:async edges=>{
            for(const {node:n}of edges){
              if(!n?.id||!n.path)continue;
              cursor.seen_ids=[...new Set([...(cursor.seen_ids??[]),String(n.id)])];
              const item={id:`enjoei-${n.id}`,title:n.title?.name??'',price_brl:Number(n.price?.current),url:`https://www.enjoei.com.br/p/${n.path}`,
                source:'Enjoei',term:spec.id,search_terms:[id],status:'active'};
              metrics[id]??={raw:0,outside_price:0,scope_rejected:0};metrics[id].raw++;
              if(item.price_brl<OLED_PRICE.min||item.price_brl>OLED_PRICE.max){metrics[id].outside_price++;continue;}
              if(!isCompleteOledMonitor(item)){metrics[id].scope_rejected++;continue;}
              const existing=collected.get(key(item));
              if(existing){existing.search_terms=[...new Set([...existing.search_terms,id])];continue;}
              await resolveItem(item,async()=>{
                const res=await fetch(`https://pages.enjoei.com.br/products/${n.id}/v2.json`,{headers:{accept:'application/json'},signal:AbortSignal.timeout(15000)});
                if(!res.ok)throw Error(`Detalhe Enjoei HTTP ${res.status}`);
                const p=await res.json();
                return {description_evidence:p.description??'',detail_title:p.title??'',details_checked_at:nowIso(),
                  identity_error:String(p.id)===String(n.id)?null:'Identidade do produto divergente'};
              });
            }
          }});
        await finishQuery('Enjoei',spec,result.complete,result.reason,{...metrics[id],search_requests:count.Enjoei.search_requests-before,limited:!result.complete});
      }catch(error){await finishQuery('Enjoei',spec,false,error.message,{...metrics[id],search_requests:count.Enjoei.search_requests-before});}
      await sleep(250);
    }
  }
  if(!skipOlx) {
    const plan=planOledQueries('OLX',coverage,{fullSweep,explicit,traffic:await readOlxTraffic()}), visible=args.includes('--visible');
    let remaining=Date.parse(blocks.OLX?.blocked_until??'')-Date.now();
    // The morning job can reach this collector a few minutes before a 24h
    // pause expires. Wait locally instead of losing the whole morning slot.
    if(remaining>0&&remaining<=5*60_000){
      console.log(`OLED OLX: pausa termina em ${Math.ceil(remaining/60_000)} min; aguardando sem acessar o site.`);
      while(remaining>0){await sleep(Math.min(30_000,remaining));remaining=Date.parse(blocks.OLX.blocked_until)-Date.now();}
    }
    if(Date.parse(blocks.OLX?.blocked_until??'')>Date.now()){
      deferred.push(...plan.map(s=>`OLX:${s.id}`));
      const retryAt=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(blocks.OLX.blocked_until));
      console.log(`OLED OLX: pausa após bloqueio até ${retryAt} BRT; ${plan.length} consultas adiadas. Nenhum acesso realizado.`);
    }else{
      scheduled.push(...plan.map(s=>`OLX:${s.id}`));
      if(blocks.OLX)console.log('OLED OLX: prazo da pausa encerrado; retomando pela primeira consulta. Novo bloqueio interrompe a fonte.');
      try{
        const result=await collectOlx({terms:plan.map(s=>s.query),categoryUrls:['https://www.olx.com.br/brasil/informatica/monitores'],
          userDataDir:path.join(root,'.chrome-oled-monitores-profile'),headless:args.includes('--headless'),visible,
          inRange:price=>price>=OLED_PRICE.min&&price<=OLED_PRICE.max,sizeOk:()=>true,notExcluded:()=>true,
          itemFilter:isCompleteOledMonitor,termMatcher:title=>isCompleteOledMonitor({title}),olxDeliveryOnly:true,
          maxCards:budgets.OLX.cards,reportLimits:true,
          transformItem:async(item,{context})=>{
            const id=`OLX:${item.term}`;item.search_terms=[id];
            const existing=collected.get(key(item));
            if(existing){existing.search_terms=[...new Set([...existing.search_terms,id])];return existing;}
            return resolveItem(item,async()=>{
              const tab=await context.newPage();
              try{
                await tab.goto(item.url,{waitUntil:'domcontentloaded',timeout:25000});
                const d=await tab.evaluate(readOlxNotebookDetail);assertOlxAccessible(d.body_text);
                const price=d.price_text?parseBrlPrice(d.price_text):Number(d.structured_price)||null;
                return {description_evidence:d.description,detail_title:d.title,details_checked_at:nowIso(),
                  identity_error:extractOlxId(d.url)===extractOlxId(item.url)?null:'Página aberta não corresponde ao anúncio',
                  price_error:price==null?'Preço integral não localizado':Math.abs(price-item.price_brl)>1?'Preço da listagem diverge do detalhe':null};
              }finally{await tab.close().catch(()=>{});}
            });
          },onSearchAttempt:async()=>{count.OLX.search_requests++;},
          onTerm:async(query,m)=>{await finishQuery('OLX',plan.find(s=>s.query===query),!m.limited,null,m);},
        });
        if(result.blocked){const reason=[...result.failedTermErrors.values()].at(-1);blocks.OLX={blocked_until:new Date(Date.now()+24*3600_000).toISOString(),reason};}
        else if(!result.failedTerms.size)delete blocks.OLX;
        for(const query of result.failedTerms)failed.set(`OLX:${query}`,result.failedTermErrors.get(query));
        for(const query of result.deferredTerms){
          const id=`OLX:${query}`;deferred.push(id);
          const index=scheduled.indexOf(id);if(index>=0)scheduled.splice(index,1);
        }
      }catch(error){for(const spec of plan)failed.set(`OLX:${spec.id}`,error.message);}
    }
  }
  if(!scheduled.length&&!deferred.length){
    if(skipOlx&&skipEnjoei){console.log('OLED: todas as fontes desativadas nesta execução.');return;}
    deferred.push(...configured.filter(id=>id.startsWith('OLX:')?!skipOlx:!skipEnjoei));
    console.log('OLED: consultas adiadas pelos intervalos programados; nenhum acesso necessário.');
  }
  const completed=nowIso(), current=[...collected.values()];
  for(const [id,m]of Object.entries(metrics)){
    const hits=current.filter(item=>item.search_terms?.includes(id));
    m.approved=hits.filter(isApprovedOledMonitor).length;
    m.exclusive=hits.filter(item=>isApprovedOledMonitor(item)&&item.search_terms.length===1).length;
  }
  const unsuccessful=scheduled.filter(id=>!success.includes(id));
  const snapshot=mergeMonitorSnapshot({previousSnapshot:previous,collected:current,now:new Date(completed),
    configuredCoverage:configured,scheduledCoverage:scheduled,successfulCoverage:success.filter(id=>!failed.has(id)),failedCoverage:unsuccessful,
    itemCoverage:item=>item.search_terms??(item.source&&item.term?[`${item.source}:${item.term}`]:[]),filters:{price_brl:OLED_PRICE},
    run:{label:'Monitores OLED',started_at:started,completed_at:completed,partial:unsuccessful.length>0||deferred.length>0,
      deferred_coverage:deferred,
      errors:[...unsuccessful.map(id=>`${id}: ${failed.get(id)??'Consulta não executada após interrupção'}`),
        ...(deferred.length?[blocks.OLX?.blocked_until&&Date.parse(blocks.OLX.blocked_until)>Date.now()
          ?`OLX: consultas adiadas após bloqueio; retomada prevista em ${new Date(blocks.OLX.blocked_until).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})} BRT.`
          :'Consultas adiadas por frequência ou orçamento compartilhado.']:[])],
      oled_policy_version:OLED_POLICY_VERSION,discovery:{sources:count,budgets,query_yield:metrics}}});
  snapshot.items=snapshot.items.map(classifySavedOledItem);
  snapshot.pending_items=Object.values(state.pending).filter(item=>item.oled_validation?.state==='pending'&&oledPendingReason(item));
  snapshot.source_blocks=blocks;snapshot.price_range_brl=OLED_PRICE;
  snapshot.run.search_schedule=['OLX','Enjoei'].flatMap(source=>oledQuerySpecs(source).map(spec=>({...spec,source,
    last_success_at:snapshot.coverage_status[`${source}:${spec.id}`]?.last_success_at??null,
    state:snapshot.coverage_status[`${source}:${spec.id}`]?.state??'pending'})));
  const report=renderOledReport(snapshot,previous);
  const committed = await commitMonitorRun(dataDir,{runId:completed.replace(/[:.]/g,'-'),snapshot,report,metadata:{source:'monitores-oled',collected_count:current.length}});
  await save();
  console.log(`OLED: ${current.filter(isApprovedOledMonitor).length} aprovado(s), ${snapshot.pending_items.length} pendente(s).`);
  if(snapshot.run.partial){
    console.error(`Coleta OLED parcial: ${unsuccessful.length} consulta(s) incompleta(s), ${deferred.length} adiada(s).`);
    for(const error of snapshot.run.errors.slice(0,3))console.error(error);
    setMonitorExit(committed.snapshot.run);
  }
}

export function renderOledReport(snapshot,previous) {
  const changes=buildMonitorChanges(previous?{...previous,items:previous.items.filter(hasApprovedOledEvidence)}:null,snapshot,
    {include:item=>item.status==='active'&&isApprovedOledMonitor(item),reactivationIsNew:false});
  const active=snapshot.items.filter(i=>i.status==='active'&&isApprovedOledMonitor(i));
  const line=item=>`- R$ ${Number(item.price_brl).toLocaleString('pt-BR',{minimumFractionDigits:2})} — ${item.title} — ${item.url}`;
  const lines=[`# Monitor Monitores OLED — ${snapshot.run.date??snapshot.generated_at.slice(0,10)}`,'','## Resumo executivo',
    `- Novos produtos: **${changes.newItems.length}**`,`- Alterações de preço: **${changes.priceChanges.length}**`,
    `- Já vistos e ativos: **${active.length-changes.newItems.length}**`,`- Cobertura parcial: **${snapshot.run.partial?'sim':'não'}**`,
    '- Faixa de preço: R$ 1.500–3.000. Aprovação automática não comprova estado físico ou ausência de burn-in.'];
  if(snapshot.run.policy_reclassification)lines.push(`- Reclassificação de dados salvos; coleta original: ${snapshot.run.completed_at}.`);
  for(const [source,c]of Object.entries(snapshot.run.discovery?.sources??{}))lines.push(`- ${source}: ${c.search_requests} consultas, ${c.detail_reads} detalhes, ${c.cache_hits} usos de cache.`);
  lines.push('','## Novos produtos',...(changes.newItems.length?changes.newItems.map(line):['- Nenhum.']),
    '','## Já vistos e ativos',...active.filter(i=>!changes.newItems.some(n=>n.id===i.id)).map(line),
    '','## Mudanças de preço',...(changes.priceChanges.length?changes.priceChanges.map(i=>`${line(i)} — anterior: R$ ${i.previous_price_brl}`):['- Nenhum.']),
    '','## Candidatos pendentes de conferência',...(snapshot.pending_items??[]).map(i=>`${line(i)} — Pendente: ${i.oled_validation.reasons.join('; ')}`));
  const stale=snapshot.items.filter(i=>assessOledMonitor(i).state==='approved'&&oledPendingReason(i));
  if(stale.length)lines.push('','## Aguardando atualização',...stale.map(i=>`${line(i)} — Último preço observado; ${oledPendingReason(i)}`));
  if(snapshot.run.partial)lines.push('','## Cobertura incompleta',...(snapshot.run.errors??[]).map(e=>`- ${e}`));
  return lines.join('\n');
}
