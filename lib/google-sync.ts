import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {mutate,readStore} from './store';
import {cloudQuery,cloudTransaction} from './cloud-database';
import {useCloudStorage} from './deployment';
import type {Batch,GoogleSync,Store} from './types';
import {googleConnectionScript} from './google-script';
export const googleSpreadsheetId='10Cji9fGZenyi4BLnIodt98z8C1iAPTo3yWCPTaNjpoE';
type Connection={token:string;url?:string};
const cleanSetting=(value?:string)=>value?.trim().replace(/^(["'])(.*)\1$/,'$2').trim()||'';
const connectionFile=()=>process.env.GOOGLE_SYNC_CONNECTION_FILE||path.join(process.cwd(),'data','private','google-connection.json');
async function connection():Promise<Connection|null>{
 if(process.env.GOOGLE_SYNC_URL){
  return {url:cleanSetting(process.env.GOOGLE_SYNC_URL),token:cleanSetting(process.env.GOOGLE_SYNC_TOKEN)||cleanSetting(process.env.Google_sync_token)};
 }
 try{return JSON.parse(await fs.readFile(connectionFile(),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
}
async function saveConnection(config:Connection){const file=connectionFile();await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify(config),{mode:0o600});await fs.rename(file+'.tmp',file);}
export async function googleConnectionStatus(){
 const config=await connection();
 const configurationIssue=!config?.url?'GOOGLE_SYNC_URL is missing from this deployment.':!validConnectionUrl(config.url)?'GOOGLE_SYNC_URL must be the Google Apps Script web app URL ending in /exec.':!config.token?'GOOGLE_SYNC_TOKEN is missing from this deployment.':undefined;
 return {connected:!configurationIssue,configurationIssue,spreadsheetId:googleSpreadsheetId};
}
export async function prepareGoogleConnection(){let config=await connection();if(!config){config={token:randomBytes(32).toString('hex')};await saveConnection(config);}return googleConnectionScript(config.token);}
export function validConnectionUrl(value:string){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='script.google.com'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&/^\/macros\/s\/[a-zA-Z0-9_-]{16,}\/exec$/.test(u.pathname);}catch{return false;}}
async function callGoogle(config:Connection,payload:Record<string,unknown>){
 if(!config.url||!validConnectionUrl(config.url))throw Error('Google Sheets webhook URL is invalid. Must end in /exec.');
 const response=await fetch(config.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:config.token,spreadsheetId:googleSpreadsheetId,...payload}),signal:AbortSignal.timeout(55_000),cache:'no-store'});
 if(!response.ok)throw Error('Google Apps Script is unavailable or timed out. Retry the saved upload.');
 const result=await response.json().catch(()=>{throw Error('Google did not return a sync receipt. Check the web-app deployment URL and access settings (must be Execute as: Me, Access: Anyone).');});
 if(!result.ok||result.spreadsheetId!==googleSpreadsheetId)throw Error(typeof result.error==='string'?result.error.slice(0,220):'Google sync could not be verified.');
 return result;
}
export async function connectGoogle(url:string){if(!validConnectionUrl(url))throw Error('Use the Google Apps Script web-app URL ending in /exec.');const config=await connection();if(!config)throw Error('Copy the connection script first.');await callGoogle({...config,url},{action:'ping'});await saveConnection({...config,url});return {connected:true};}
export function batchSyncPayload(batch:Batch){
 if(!batch.poolAppends?.length)throw Error('This upload has no destination allocations.');
 const count=batch.poolAppends.reduce((n,a)=>n+a.cells.length,0);
 const countToVerify=batch.valid||count;
 if(!count||count!==countToVerify)throw Error('Upload count does not match the saved ranges.');
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(batch.at));
 const dateSerial=Math.round((Date.parse(date+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000);
 const phoneColumns:Record<string,number>={Telugu:3,Tamil:4,Kannada:4,Hindi:6,Malayalam:3};
 return {id:batch.id,file:batch.file,clientId:batch.purpose?(batch.clientId||''):(batch.clientId||'mmsoctm'),series:batch.purpose?(Number(batch.series)||0):(Number(batch.series||'1')||1),dateSerial,count:countToVerify,allocations:batch.poolAppends.map(a=>({language:a.language,start:a.start,cells:a.cells.map(row=>row.map((v,i)=>{if(i!==phoneColumns[a.language])return String(v??'');const digits=String(v??'').replace(/\D/g,'');return digits.length===12&&digits.startsWith('91')?digits.slice(2):digits;}))}))};
}
export function verifiedGoogleReceipt(batch:Batch,result:Record<string,unknown>):GoogleSync{
 const expected=Object.fromEntries((batch.poolAppends||[]).map(a=>[a.language,`${a.start}-${a.start+a.cells.length-1}`]));
 if(result.batchId!==batch.id||result.written!==batch.valid||!Number.isSafeInteger(result.reportRow)||(result.reportRow as number)<2||(!result.ranges||typeof result.ranges!=='object'||Object.keys(result.ranges).length!==Object.keys(expected).length||Object.entries(expected).some(([k,v])=>(result.ranges as Record<string,unknown>)[k]!==v)))throw Error('Google returned a different range or count. The upload remains pending review.');
 return {at:new Date().toISOString(),spreadsheetId:googleSpreadsheetId,reportRow:result.reportRow as number,written:batch.valid,held:0,ranges:expected,conflictRows:[],series:batch.series,clientId:batch.clientId};
}
const pendingInOrder=(batches:Batch[])=>batches.filter(b=>!b.googleSync&&b.poolAppends?.length&&b.valid>0)
 .sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
// Keep the workspace lock and revision history, but transfer only queue metadata.
async function mutateSync<T>(id:string,change:(state:Pick<Store,'batches'|'operations'|'audit'>)=>T):Promise<T>{
 if(!useCloudStorage())return mutate(change);
 return cloudTransaction(async()=>{
  const locked=await cloudQuery<{batches:Batch[]}>(
   `select (select coalesce(jsonb_agg(jsonb_build_object(
     'id',b->'id','at',b->'at','file',b->'file','sourceFile',b->'sourceFile',
     'valid',b->'valid','syncJob',b->'syncJob','googleSync',b->'googleSync',
     'poolAppends',case when jsonb_array_length(coalesce(nullif(b->'poolAppends','null'::jsonb),'[]'::jsonb))>0 then '[{}]'::jsonb else '[]'::jsonb end
    ) order by ord),'[]'::jsonb) from jsonb_array_elements(payload->'batches') with ordinality as items(b,ord)) as batches
    from capital_grow.workspace where id=1 for update`);
  const state={batches:locked.rows[0]?.batches??[],audit:[] as Store['audit'],operations:undefined};
  const index=state.batches.findIndex(b=>b.id===id),before=JSON.stringify(state.batches[index]);
  const result=change(state);
  const batch=state.batches[index];
  if(batch&&JSON.stringify(batch)!==before){
   const patch=JSON.stringify({syncJob:batch.syncJob,...(batch.googleSync?{googleSync:batch.googleSync}:{})});
   await cloudQuery(`with updated as (
    update capital_grow.workspace set payload=jsonb_set(
     jsonb_set(payload,array['batches',$1],(payload #> array['batches',$1]) || $2::jsonb),
     '{audit}', $3::jsonb || coalesce(payload->'audit','[]'::jsonb)),
     revision=revision+1,updated_at=now() where id=1
    returning revision,payload,source_hash
   ) insert into capital_grow.workspace_versions(revision,payload,source_hash)
      select revision,payload,source_hash from updated`,[String(index),patch,JSON.stringify(state.audit)]);
  }
  return result;
 });
}
async function nextPendingBatch(){
 if(!useCloudStorage())return pendingInOrder((await readStore()).batches)[0];
 const {rows}=await cloudQuery<{batch:Batch}>(`
  select b - 'rows' as batch
  from capital_grow.workspace w cross join lateral jsonb_array_elements(w.payload->'batches') b
  where w.id=1 and b->>'googleSync' is null and (b->>'valid')::integer>0
    and jsonb_array_length(coalesce(nullif(b->'poolAppends','null'::jsonb),'[]'::jsonb))>0
  order by b->>'at',b->>'id' limit 1
 `);
 return rows[0]?.batch;
}
export async function syncBatch(batchId:string,force=true):Promise<GoogleSync>{
 const batch=(await readStore()).batches.find(b=>b.id===batchId);
 if(!batch)throw Error('Upload batch not found.');
 return syncSelectedBatch(batch,force);
}
async function syncSelectedBatch(batch:Batch,force:boolean):Promise<GoogleSync>{
 const batchId=batch.id;
 const config=await connection();
 if(!config?.url){
  throw Error('Google Sheets webhook URL is not configured. Set GOOGLE_SYNC_URL in .env.local to enable automatic syncing to the live Google Sheet.');
 }
 if(batch.googleSync)return batch.googleSync;
 if(!batch.poolAppends?.length||batch.valid<=0)throw Error('This upload has no destination allocations or valid leads.');
 const claimed=await mutateSync(batchId,s=>{
  const b=s.batches.find(x=>x.id===batchId);
  if(!b||b.googleSync||pendingInOrder(s.batches)[0]?.id!==batchId)return false;
  if(!force&&b.syncJob?.status==='error'&&Date.now()-Date.parse(b.syncJob.updatedAt)<60_000)return false;
  if(b.syncJob?.status==='syncing'&&Date.now()-Date.parse(b.syncJob.updatedAt)<120_000)return false;
  b.syncJob={status:'syncing',attempts:(b.syncJob?.attempts||0)+1,updatedAt:new Date().toISOString()};
  return true;
 });
 if(!claimed){
  const recheck=await readStore();
  const b=recheck.batches.find(x=>x.id===batchId);
  if(b?.googleSync)return b.googleSync;
  throw Error('Sync already in progress.');
 }
 try{
  const result=await callGoogle(config,{action:'sync',batch:batchSyncPayload(batch)});
  const receipt=verifiedGoogleReceipt(batch,result);
  await mutateSync(batchId,s=>{
   const b=s.batches.find(x=>x.id===batchId);
   if(!b||b.googleSync)return;
   b.googleSync=receipt;
   b.syncJob={...b.syncJob!,status:'synced',updatedAt:receipt.at};
   const r=s.operations?.find(o=>o.sourceSheet==='CONTACT UPLOAD'&&o.series===b.id);
   if(r){
    r.notes=`Google Sheets verified: ${receipt.written} leads; MMS report row ${receipt.reportRow}. Original file: ${b.sourceFile||b.file}`;
    r.updatedAt=receipt.at;
   }
   s.audit.unshift({id:crypto.randomUUID(),at:receipt.at,by:'Google Sheets sync',role:'System',action:'Upload synced and verified',old:null,next:{batchId:b.id,...receipt}});
  });
  return receipt;
 }catch(error){
  await mutateSync(batchId,s=>{
   const b=s.batches.find(x=>x.id===batchId);
   if(b&&!b.googleSync)b.syncJob={...b.syncJob!,status:'error',updatedAt:new Date().toISOString(),message:error instanceof Error?(b.purpose&&error.message==='Invalid upload identity.'?'Update the Google Apps Script deployment to support original vendor filenames.':error.message):'Sync failed. Retry the saved upload.'};
  });
  throw error;
 }
}
const workerState=globalThis as typeof globalThis&{__cgSyncWorker?:Promise<void>;__cgSyncWorkerError?:string};
export function googleQueueError(){return workerState.__cgSyncWorkerError;}
export async function runGoogleSyncQueue(force=false){
 if(workerState.__cgSyncWorker)return workerState.__cgSyncWorker;
 const config=await connection();
 if(!config?.url||!config.token||!validConnectionUrl(config.url))return;
 workerState.__cgSyncWorkerError=undefined;
 const work=async()=>{
  const deadline=Date.now()+55_000;
  while(Date.now()<deadline){
   const batch=await nextPendingBatch();
   if(!batch)break;
   const age=Date.now()-Date.parse(batch.syncJob?.updatedAt||'');
   if(batch.syncJob?.status==='syncing'&&age<120_000)break;
   if(!force&&batch.syncJob?.status==='error'&&age<60_000)break;
   try{
    await syncSelectedBatch(batch,force);
   }catch{
    const latest=await nextPendingBatch();
    if(latest?.id===batch.id&&(latest.syncJob?.status==='pending'||!latest.syncJob))workerState.__cgSyncWorkerError='The server could not start this upload. Retry sync from Import History.';
    break;
   }
  }
 };
 const promise=work().catch(()=>{workerState.__cgSyncWorkerError='The sync queue is temporarily unavailable. Your uploads are saved.';}).finally(()=>{workerState.__cgSyncWorker=undefined;});
 workerState.__cgSyncWorker=promise;
 return promise;
}
