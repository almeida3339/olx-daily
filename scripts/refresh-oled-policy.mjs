import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLatestValidSnapshot, commitMonitorRun } from './lib/monitor-runtime.mjs';
import { OLED_POLICY_VERSION, OLED_SEARCH_TERMS, classifySavedOledItem } from './lib/oled-monitor-scope.mjs';
import { buildMercadoLivreChanges, renderMercadoLivreReport } from './lib/mercadolivre-production.mjs';
import { renderOledReport } from './lib/oled-monitor-runner.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
for(const source of ['oled-monitores','mercadolivre-oled-monitores']){
  const dir=path.join(root,'data',source),{snapshot:previous}=await readLatestValidSnapshot(dir);
  if(!previous||previous.run?.oled_policy_version===OLED_POLICY_VERSION)continue;
  const snapshot=structuredClone(previous),now=new Date().toISOString();
  snapshot.run={...snapshot.run,oled_policy_version:OLED_POLICY_VERSION,policy_reclassification:true,policy_applied_at:now};
  const ml=source.startsWith('mercadolivre-');
  if(ml){snapshot.run.kind='oled';snapshot.run.configured_terms=OLED_SEARCH_TERMS;snapshot.run.configured_coverage=OLED_SEARCH_TERMS;}
  else snapshot.run.configured_coverage=['OLX','Enjoei'].flatMap(s=>OLED_SEARCH_TERMS.map(term=>`${s}:${term}`));
  snapshot.items=snapshot.items.map(classifySavedOledItem);
  snapshot.pending_items=snapshot.items.filter(i=>i.status==='active'&&i.oled_validation.state==='pending');
  const report=ml?renderMercadoLivreReport(snapshot,buildMercadoLivreChanges(previous,snapshot,{displayMinPrice:1500,displayMaxPrice:3000,kind:'oled'}))
    :renderOledReport(snapshot,previous);
  await commitMonitorRun(dir,{runId:now.replace(/[:.]/g,'-'),snapshot,report,
    metadata:{source,policy_reclassification:true,policy_version:OLED_POLICY_VERSION,source_collected_at:previous.run.completed_at??previous.generated_at}});
  console.log(`${source}: preferências reaplicadas sem alterar a data da coleta.`);
}
