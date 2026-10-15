import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {mutate,readStore} from './store';
import type {Batch,GoogleSync} from './types';
import {googleConnectionScript} from './google-script';
export const googleSpreadsheetId='10Cji9fGZenyi4BLnIodt98z8C1iAPTo3yWCPTaNjpoE';
type Connection={token:string;url?:string};
const connectionFile=()=>process.env.GOOGLE_SYNC_CONNECTION_FILE||path.join(process.cwd(),'data','private','google-connection.json');
async function connection():Promise<Connection|null>{try{return JSON.parse(await fs.readFile(connectionFile(),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}}
async function saveConnection(config:Connection){const file=connectionFile();await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify(config),{mode:0o600});await fs.rename(file+'.tmp',file);}
export async function googleConnectionStatus(){const config=await connection();return {connected:!!config?.url,spreadsheetId:googleSpreadsheetId};}
export async function prepareGoogleConnection(){let config=await connection();if(!config){config={token:randomBytes(32).toString('hex')};await saveConnection(config);}return googleConnectionScript(config.token);}
export function validConnectionUrl(value:string){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='script.google.com'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&/^\/macros\/s\/[a-zA-Z0-9_-]{16,}\/exec$/.test(u.pathname);}catch{return false;}}
async function callGoogle(config:Connection,payload:Record<string,unknown>){
 if(!config.url||!validConnectionUrl(config.url))throw Error('Connect Google Sheets in Settings first.');
 const response=await fetch(config.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:config.token,spreadsheetId:googleSpreadsheetId,...payload}),signal:AbortSignal.timeout(55_000),cache:'no-store'});
 if(!response.ok)throw Error('Google connection is unavailable. Retry the saved upload.');
 const result=await response.json().catch(()=>{throw Error('Google did not return a sync receipt. Check the web-app deployment URL and access settings.');});
 if(!result.ok||result.spreadsheetId!==googleSpreadsheetId)throw Error(typeof result.error==='string'?result.error.slice(0,220):'Google connection could not be verified.');
 return result;
}
export async function connectGoogle(url:string){if(!validConnectionUrl(url))throw Error('Use the Google Apps Script web-app URL ending in /exec.');const config=await connection();if(!config)throw Error('Copy the connection script first.');await callGoogle({...config,url},{action:'ping'});await saveConnection({...config,url});return {connected:true};}
export function batchSyncPayload(batch:Batch){
 if(!batch.poolAppends?.length||!batch.series||!batch.clientId)throw Error('This upload has no destination allocations or series.');
 const count=batch.poolAppends.reduce((n,a)=>n+a.cells.length,0);if(count!==batch.valid||!count)throw Error('Upload count does not match the saved ranges.');
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(batch.at));
 const dateSerial=Math.round((Date.parse(date+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000);
 const phoneColumns:Record<string,number>={Telugu:3,Tamil:4,Kannada:4,Hindi:6,Malayalam:3};
 return {id:batch.id,file:batch.file,clientId:batch.clientId,series:Number(batch.series),dateSerial,count,allocations:batch.poolAppends.map(a=>({language:a.language,start:a.start,cells:a.cells.map(row=>row.map((v,i)=>{if(i!==phoneColumns[a.language])return String(v??'');const digits=String(v??'').replace(/\D/g,'');return digits.length===12&&digits.startsWith('91')?digits.slice(2):digits;}))}))};
}
export function verifiedGoogleReceipt(batch:Batch,result:Record<string,unknown>):GoogleSync{
 const expected=Object.fromEntries((batch.poolAppends||[]).map(a=>[a.language,`${a.start}-${a.start+a.cells.length-1}`]));
 if(result.batchId!==batch.id||result.written!==batch.valid||!Number.isSafeInteger(result.reportRow)||(result.reportRow as number)<2||(!result.ranges||typeof result.ranges!=='object'||Object.keys(result.ranges).length!==Object.keys(expected).length||Object.entries(expected).some(([k,v])=>(result.ranges as Record<string,unknown>)[k]!==v)))throw Error('Google returned a different range or count. The upload remains pending review.');
 return {at:new Date().toISOString(),spreadsheetId:googleSpreadsheetId,reportRow:result.reportRow as number,written:batch.valid,held:0,ranges:expected,conflictRows:[],series:batch.series,clientId:batch.clientId};
}
const workerState=globalThis as typeof globalThis&{__cgSyncWorker?:Promise<void>};
export async function runGoogleSyncQueue(force=false){
 if(workerState.__cgSyncWorker)return workerState.__cgSyncWorker;
 const config=await connection();if(!config?.url)return;
 if(workerState.__cgSyncWorker)return workerState.__cgSyncWorker;
 const work=async()=>{
   const current=await readStore();const batch=current.batches.slice().reverse().find(b=>!b.googleSync&&b.poolAppends?.length&&b.valid>0);
   if(!batch)return;
   if(batch.syncJob?.status==='syncing'&&Date.now()-Date.parse(batch.syncJob.updatedAt)<120_000)return;
   if(!force&&batch.syncJob?.status==='error'&&Date.now()-Date.parse(batch.syncJob.updatedAt)<60_000)return;
   const claimed=await mutate(s=>{const b=s.batches.find(x=>x.id===batch.id);if(!b||b.googleSync)return false;if(b.syncJob?.status==='syncing'&&Date.now()-Date.parse(b.syncJob.updatedAt)<120_000)return false;b.syncJob={status:'syncing',attempts:(b.syncJob?.attempts||0)+1,updatedAt:new Date().toISOString()};return true;});
   if(!claimed)return;
   try{
    const result=await callGoogle(config,{action:'sync',batch:batchSyncPayload(batch)}),receipt=verifiedGoogleReceipt(batch,result);
    await mutate(s=>{const b=s.batches.find(x=>x.id===batch.id);if(!b||b.googleSync)return;b.googleSync=receipt;b.syncJob={...b.syncJob!,status:'synced',updatedAt:receipt.at};const r=s.operations?.find(o=>o.sourceSheet==='CONTACT UPLOAD'&&o.series===b.id);if(r)r.notes=`Google Sheets verified: ${receipt.written} leads; MMS report row ${receipt.reportRow}. Original file: ${b.sourceFile||b.file}`;s.audit.unshift({id:crypto.randomUUID(),at:receipt.at,by:'Google Sheets sync',role:'System',action:'Upload synced and verified',old:null,next:{batchId:b.id,...receipt}});});
   }catch(error){await mutate(s=>{const b=s.batches.find(x=>x.id===batch.id);if(b&&!b.googleSync)b.syncJob={...b.syncJob!,status:'error',updatedAt:new Date().toISOString(),message:error instanceof Error?error.message:'Sync failed. Retry the saved upload.'};});return;}
 };
 const promise=work().finally(()=>{workerState.__cgSyncWorker=undefined;});workerState.__cgSyncWorker=promise;return promise;
}
