import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { classifyMonitorError } from './monitor-errors.mjs';
import { sanitizeErrorMessage } from './notification-status.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
function safeUrl(value){
  try{const url=new URL(value);url.username='';url.password='';url.hash='';
    for(const key of [...url.searchParams.keys()])if(!['q','opst','sp'].includes(key))url.searchParams.delete(key);
    return url.href;
  }catch{return null;}
}

// Local diagnostic only: never record cookies, headers, full HTML or credentials.
export async function captureOlxAccessFailure({page,error,stage,query,url,response}){
  if(error.olx_diagnostic)return error.olx_diagnostic;
  const status=response?.status()??null;
  const kind=status===429?'rate_limited':status===403?'challenge':error.kind??classifyMonitorError(error).kind;
  if(!['challenge','authentication','rate_limited'].includes(kind))return null;
  error.pageState=kind==='rate_limited'?'limited':kind==='authentication'?'logged_out':'challenge';
  const body=await page.locator('body').innerText({timeout:3000}).catch(()=> '');
  const headers=response?await response.allHeaders().catch(()=>({})):{};
  const denial=/you have been blocked|you are unable to access|unable to access olx/i.test(body);
  const ray=body.match(/Cloudflare Ray ID:\s*([a-z0-9]+)/i)?.[1]??headers?.['cf-ray']??null;
  const diagnostic={id:`olx-access-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomUUID().slice(0,8)}`,
    at:new Date().toISOString(),stage,query,url:safeUrl(url),final_url:safeUrl(page.url()),
    http_status:status,title:sanitizeErrorMessage(await page.title().catch(()=>'')),
    kind:denial?'hard_denial':kind,ray_id:ray,
    message:sanitizeErrorMessage(error.message),excerpt:sanitizeErrorMessage(body.slice(0,1800))};
  error.olx_diagnostic=diagnostic;
  try{
    const dir=process.env.OLX_DIAGNOSTICS_DIR??path.join(root,'logs','olx-access');
    await fs.mkdir(dir,{recursive:true});
    if(kind!=='authentication')await page.screenshot({path:path.join(dir,`${diagnostic.id}.png`),timeout:5000}).catch(()=>{});
    await fs.writeFile(path.join(dir,`${diagnostic.id}.json`),JSON.stringify(diagnostic,null,2));
    const files=(await fs.readdir(dir)).filter(name=>/^olx-access-\d{4}-.*-[a-f0-9]{8}\.(?:json|png)$/.test(name)).sort();
    for(const name of files.slice(0,Math.max(0,files.length-40)))await fs.unlink(path.join(dir,name)).catch(()=>{});
  }catch(writeError){console.warn(`OLX: não foi possível guardar diagnóstico local: ${sanitizeErrorMessage(writeError.message)}`);}
  console.warn(JSON.stringify({event:'olx_access_blocked',...diagnostic,excerpt:undefined}));
  return diagnostic;
}
