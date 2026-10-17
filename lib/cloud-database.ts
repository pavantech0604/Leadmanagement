import {assertSaleLedgerChanges} from './lead-finance';
import {DeploymentError,databaseConnectionUrl} from './deployment';
import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs';
import {Pool,type PoolClient,type QueryResultRow} from 'pg';
import {createHash} from 'node:crypto';
import type {Store} from './types';

export const cloudEnabled=()=>process.env.STORAGE_BACKEND==='supabase';
const shared=globalThis as typeof globalThis&{__cgCloudPool?:Pool;__cgCloudTransaction?:AsyncLocalStorage<PoolClient>};
shared.__cgCloudTransaction??=new AsyncLocalStorage<PoolClient>();
export function cloudPool(){
 if(!shared.__cgCloudPool){
  const connectionString=process.env.SUPABASE_DATABASE_URL;if(!connectionString)throw new Error('Secure database connection is not configured.');
  const url=databaseConnectionUrl(connectionString);const local=['localhost','127.0.0.1','::1'].includes(url.hostname);
  if(!local&&!url.hostname.endsWith('.supabase.co')&&!url.hostname.endsWith('.pooler.supabase.com'))throw new Error('Unexpected database host.');
  // Strip connection-string SSL switches so they cannot disable verification.
  for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])url.searchParams.delete(key);
  shared.__cgCloudPool=new Pool({connectionString:url.toString(),max:2,connectionTimeoutMillis:10000,idleTimeoutMillis:30000,statement_timeout:30000,ssl:local?false:{rejectUnauthorized:true,...(process.env.SUPABASE_DB_CA_CERT?{ca:process.env.SUPABASE_DB_CA_CERT.replace(/\\n/g,'\n')}:process.env.SUPABASE_DB_CA_PATH?{ca:fs.readFileSync(process.env.SUPABASE_DB_CA_PATH,'utf8')}: {})}});
 }
 return shared.__cgCloudPool;
}
export function cloudQuery<T extends QueryResultRow=QueryResultRow>(sql:string,values:unknown[]=[]){return (shared.__cgCloudTransaction!.getStore()||cloudPool()).query<T>(sql,values)}
export async function cloudTransaction<T>(fn:()=>Promise<T>){
 if(shared.__cgCloudTransaction!.getStore())return fn();
 const client=await cloudPool().connect();try{await client.query('begin');await client.query("set local lock_timeout = '15s'");const result=await shared.__cgCloudTransaction!.run(client,fn);await client.query('commit');return result}catch(e){await client.query('rollback').catch(()=>{});throw e}finally{client.release()}
}
export async function readCloudStore(){const {rows}=await cloudQuery('select payload from capital_grow.workspace where id=1');if(!rows[0])throw new DeploymentError('The cloud workspace has not been initialized. Import the private local workspace with npm run cloud:initialize before using this deployment.');return rows[0].payload as Store}
const sourceKey='capital-grow-language-pools';
export async function reserveRecords(s:Store,before:Store){
 assertSaleLedgerChanges(before,s);
 const existing=new Map((before.transfers||[]).map(t=>[t.id,t]));
 for(const t of before.transfers||[])if(JSON.stringify(s.transfers?.find(v=>v.id===t.id))!==JSON.stringify(t))throw new Error('Committed transfers cannot be changed or removed.');
 for(const t of s.transfers||[]){if(existing.has(t.id))continue;
  await cloudQuery('insert into capital_grow.transfers(id,request_key,request_hash,file_name,floor,operator_id,committed_at,payload) values($1,$2,$3,$4,$5,$6,$7,$8)',[t.id,t.key,t.requestHash,t.file,t.floor,t.userId,t.at,t]);
  await cloudQuery('insert into capital_grow.file_reservations(normalized_name,operation_id) values(lower(btrim($1)),$2)',[t.file,t.operationId]);
  for(const a of t.mode==='reuse'?[]:t.allocations)await cloudQuery('insert into capital_grow.row_allocations(source_key,language,row_number,operation_id) select $1,$2,n,$3 from generate_series($4::integer,$5::integer) n',[sourceKey,a.language,t.operationId,a.start,a.end]);
 }
 const smart=new Set((s.transfers||[]).map(t=>t.operationId)),previous=new Map((before.operations||[]).map(r=>[r.id,JSON.stringify(r)]));
 for(const r of s.operations||[]){if(smart.has(r.id)||previous.get(r.id)===JSON.stringify(r))continue;
  if(r.file.trim())await cloudQuery('insert into capital_grow.file_reservations(normalized_name,operation_id) values(lower(btrim($1)),$2) on conflict do nothing',[r.file,r.id]);
  if(r.kind==='dispatch')for(const a of r.segments)if(a.start!==null&&a.end!==null&&a.count!==null&&a.end-a.start<=100000)await cloudQuery('insert into capital_grow.row_allocations(source_key,language,row_number,operation_id) select $1,$2,n,$3 from generate_series($4::integer,$5::integer) n on conflict do nothing',[sourceKey,a.language,r.id,a.start,a.end]);
 }
}
export async function mutateCloudStore<T>(fn:(s:Store)=>T|Promise<T>){return cloudTransaction(async()=>{
 const {rows}=await cloudQuery('select payload,revision,source_hash from capital_grow.workspace where id=1 for update');if(!rows[0])throw new DeploymentError('The cloud workspace has not been initialized. Import the private local workspace with npm run cloud:initialize before using this deployment.');
 const s=rows[0].payload as Store,before=structuredClone(s),result=await fn(s);
 if(JSON.stringify(s)!==JSON.stringify(before)){
  await reserveRecords(s,before);
  const updated=await cloudQuery('update capital_grow.workspace set payload=$1,revision=revision+1,updated_at=now() where id=1 returning revision,source_hash',[s]);
  await cloudQuery('insert into capital_grow.workspace_versions(revision,payload,source_hash) values($1,$2,$3)',[updated.rows[0].revision,s,updated.rows[0].source_hash]);
 }
 return result;
})}
export async function readCloudSource(){const {rows}=await cloudQuery('select s.hash,s.content from capital_grow.source_workbooks s join capital_grow.workspace w on w.source_hash=s.hash where w.id=1');if(!rows[0])throw new Error('The source workbook is not imported.');return {hash:String(rows[0].hash),buffer:rows[0].content as Buffer}}
export async function saveCloudSource(buffer:Buffer){const hash=createHash('sha256').update(buffer).digest('hex');await cloudQuery('insert into capital_grow.source_workbooks(hash,content) values($1,$2) on conflict do nothing',[hash,buffer]);await cloudQuery('update capital_grow.workspace set source_hash=$1 where id=1',[hash]);return hash}
export async function securityEvent(actor:string|null,event:string,details:Record<string,unknown>={}){if(cloudEnabled())await cloudQuery('insert into capital_grow.security_events(actor_id,event,details) values($1,$2,$3)',[actor,event,details])}
export async function rateLimit(key:string,max:number,seconds:number){if(!cloudEnabled())return;const {rows}=await cloudQuery(`insert into capital_grow.rate_limits(key,window_start,count) values($1,now(),1) on conflict(key) do update set count=case when capital_grow.rate_limits.window_start < now()-make_interval(secs=>$2) then 1 else capital_grow.rate_limits.count+1 end, window_start=case when capital_grow.rate_limits.window_start < now()-make_interval(secs=>$2) then now() else capital_grow.rate_limits.window_start end returning count`,[key,seconds]);if(rows[0].count>max)throw new Error('Too many requests. Please wait and try again.');}
