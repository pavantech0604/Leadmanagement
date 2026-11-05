import {assertSaleLedgerChanges} from './lead-finance';
import {DeploymentError,databaseConnectionUrl,isTransientDatabaseError} from './deployment';
import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs';
import {Pool,type PoolClient,type QueryResultRow} from 'pg';
import {createHash} from 'node:crypto';
import type {Store} from './types';

export const cloudEnabled=()=>process.env.STORAGE_BACKEND==='supabase';
const shared=globalThis as typeof globalThis&{__cgCloudPool?:Pool;__cgReadFallbackPool?:Pool;__cgCloudTransaction?:AsyncLocalStorage<PoolClient>};
shared.__cgCloudTransaction??=new AsyncLocalStorage<PoolClient>();
export function cloudPool(alternate=false){
 const key=alternate?'__cgReadFallbackPool':'__cgCloudPool';
 if(!shared[key]){
  const connectionString=process.env.SUPABASE_DATABASE_URL;
  if(!connectionString)throw new DeploymentError('Secure database connection is not configured.');
  const url=databaseConnectionUrl(connectionString);
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(alternate){
   if(!url.hostname.endsWith('.pooler.supabase.com')||!['','5432','6543'].includes(url.port))return cloudPool();
   url.port=url.port==='6543'?'5432':'6543';
  }
  // Never allow connection-string options to weaken TLS.
  for(const name of ['sslmode','sslcert','sslkey','sslrootcert'])url.searchParams.delete(name);
  shared[key]=new Pool({connectionString:url.toString(),max:alternate?1:2,connectionTimeoutMillis:8000,idleTimeoutMillis:15000,statement_timeout:30000,query_timeout:35000,keepAlive:true,ssl:local?false:{rejectUnauthorized:true,...(process.env.SUPABASE_DB_CA_CERT?{ca:process.env.SUPABASE_DB_CA_CERT.replace(/\\n/g,'\n')}:process.env.SUPABASE_DB_CA_PATH?{ca:fs.readFileSync(process.env.SUPABASE_DB_CA_PATH,'utf8')}: {})}});
  shared[key].on('error',error=>console.warn('Idle Supabase connection closed',{code:(error as {code?:string}).code}));
 }
 return shared[key];
}
export function cloudQuery<T extends QueryResultRow=QueryResultRow>(sql:string,values:unknown[]=[]){return (shared.__cgCloudTransaction!.getStore()||cloudPool()).query<T>(sql,values)}
function cloudImportWrite(sql:string,values:unknown[]=[]){
 const client=shared.__cgCloudTransaction!.getStore();
 if(!client)throw new Error('Import write requires a transaction.');
 const query={text:sql,values,query_timeout:80000};
 return client.query(query);
}
export async function cloudTransaction<T>(fn:()=>Promise<T>,alternate=false){
 if(shared.__cgCloudTransaction!.getStore())return fn();
 let client:PoolClient;
 try{client=await cloudPool(alternate).connect();}
 catch(error){
  // No transaction has started, so retrying the connection cannot repeat a write.
  if(!isTransientDatabaseError(error))throw error;
  await new Promise(resolve=>setTimeout(resolve,350));
  client=await cloudPool(!alternate).connect();
 }
 let discard=false;
 const onDisconnect=()=>{discard=true;};
 // A checked-out pg client emits its own error on socket loss.
 client.on('error',onDisconnect);
 try{
  await client.query('begin');
  await client.query("set local lock_timeout = '15s'");
  const result=await shared.__cgCloudTransaction!.run(client,fn);
  await client.query('commit');
  return result;
 }catch(error){
  discard=discard||isTransientDatabaseError(error)||/query read timeout/i.test(error instanceof Error?error.message:'');
  if(!discard)try{await client.query('rollback');}catch{discard=true;}
  throw error;
 }finally{client.release(discard);client.removeListener('error',onDisconnect);}
}
export async function readCloudStore(view=false,includeContacts=true){
 const sql=view?`select
  (payload - array['leads','batches','audit','sales','transfers']) || jsonb_build_object(
   'leads',case when $1::boolean then coalesce((select jsonb_agg(l-'custom' order by n) from jsonb_array_elements(payload->'leads') with ordinality as x(l,n)),'[]'::jsonb) else '[]'::jsonb end,
   'batches',coalesce((select jsonb_agg((b-array['rows','poolAppends']) || jsonb_build_object(
    'rows',coalesce((select jsonb_agg(case when r->>'state'='Valid' then jsonb_build_object('state','Valid','phone',r->'phone') else r-'raw' end order by rn)
     from jsonb_array_elements(b->'rows') with ordinality as q(r,rn) where r->>'state' like '%uplicate%' or (b->'purchase' is not null and r->>'state'='Valid')),'[]'::jsonb),
    'appendRanges',coalesce((select jsonb_agg(jsonb_build_object('language',a->'language','start',a->'start','count',jsonb_array_length(a->'cells')) order by an)
     from jsonb_array_elements(nullif(b->'poolAppends','null'::jsonb)) with ordinality as z(a,an)),'[]'::jsonb)
    ) order by n) from jsonb_array_elements(payload->'batches') with ordinality as x(b,n)),'[]'::jsonb),
   'audit',coalesce((select jsonb_agg(a-array['old','next'] order by n) from jsonb_array_elements(payload->'audit') with ordinality as x(a,n) where n<=100),'[]'::jsonb),
   'auditTotal',coalesce(jsonb_array_length(payload->'audit'),0),
   'sales',coalesce((select jsonb_agg(a-'artifact' order by n) from jsonb_array_elements(nullif(payload->'sales','null'::jsonb)) with ordinality as x(a,n)),'[]'::jsonb)
  ) as payload from capital_grow.workspace where id=1`:'select payload from capital_grow.workspace where id=1';
 for(let attempt=0;;attempt++){
  try{
   const {rows}=await (attempt===0?cloudQuery(sql,view?[includeContacts]:[]):cloudPool(true).query(sql,view?[includeContacts]:[]));
   if(!rows[0])throw new DeploymentError('The cloud workspace has not been initialized. Import the private local workspace with npm run cloud:initialize before using this deployment.');
   return rows[0].payload as Store;
  }catch(error){
   if(attempt>0||shared.__cgCloudTransaction!.getStore()||(!isTransientDatabaseError(error)&&!(view&&/query read timeout/i.test(error instanceof Error?error.message:''))))throw error;
   await new Promise(resolve=>setTimeout(resolve,350+Math.random()*250));
  }
 }
}
// Sync polling only needs authorization and queue metadata.
export async function readCloudSyncStatus():Promise<Store>{
 const sql=`select jsonb_build_object(
  'users',payload->'users','operationsSyncAt',payload->'operationsSyncAt',
  'batches',coalesce((select jsonb_agg(jsonb_build_object(
   'id',b->'id','file',b->'file','at',b->'at','valid',b->'valid','syncJob',b->'syncJob','googleSync',b->'googleSync',
   'appendRanges',case when jsonb_array_length(coalesce(nullif(b->'poolAppends','null'::jsonb),'[]'::jsonb))>0 then '[{}]'::jsonb else '[]'::jsonb end
  )) from jsonb_array_elements(payload->'batches') b),'[]'::jsonb)
 ) as payload from capital_grow.workspace where id=1`;
 const result=await cloudPool().query<{payload:Store}>(sql).catch(error=>{
  if(!isTransientDatabaseError(error))throw error;
  return cloudPool(true).query<{payload:Store}>(sql);
 });
 if(!result.rows[0])throw new DeploymentError('The cloud workspace has not been initialized.');
 return result.rows[0].payload;
}
// Import validation needs identity columns, not contact history or raw import rows.
export async function readCloudImportStore():Promise<Store>{
 const {rows}=await cloudQuery<{payload:Store}>(`select jsonb_build_object(
  'users',payload->'users','branches',payload->'branches','languages',payload->'languages','operations',payload->'operations',
  'leads',coalesce((select jsonb_agg(jsonb_build_object('id',l->'id','name',l->'name','phone',l->'phone','email',l->'email') order by n) from jsonb_array_elements(payload->'leads') with ordinality as x(l,n)),'[]'::jsonb),
  'batches',coalesce((select jsonb_agg(jsonb_build_object('id',b->'id','file',b->'file','confirmationToken',b->'confirmationToken','valid',b->'valid','duplicates',b->'duplicates','branchId',b->'branchId','by',b->'by','googleSync',b->'googleSync','poolAppends',b->'poolAppends') order by n) from jsonb_array_elements(payload->'batches') with ordinality as x(b,n)),'[]'::jsonb)
 ) as payload from capital_grow.workspace where id=1`);
 if(!rows[0])throw new DeploymentError('The cloud workspace has not been initialized.');
 return rows[0].payload;
}
export async function readCloudSourceHash(){
 const {rows}=await cloudQuery<{source_hash:string}>('select source_hash from capital_grow.workspace where id=1');
 return rows[0]?.source_hash;
}
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
// Confirm against a locked workspace, then persist only the new import records.
export async function appendCloudImport<T>(fn:(s:Store)=>Promise<T>,canRecover=false):Promise<T>{
 try{return await appendCloudImportOnce(fn,false);}
 catch(error){
  const code=(error as {code?:string})?.code;
  if(!canRecover||(!isTransientDatabaseError(error)&&!['55P03','40001','40P01'].includes(code||'')&&!/query read timeout/i.test(error instanceof Error?error.message:'')))throw error;
  // The same confirmation token is checked under the lock on either pooler.
  return appendCloudImportOnce(fn,true);
 }
}
async function appendCloudImportOnce<T>(fn:(s:Store)=>Promise<T>,alternate:boolean):Promise<T>{
 let phase='connect';
 try{return await cloudTransaction(async()=>{
  phase='workspace lock';
  await cloudQuery('select id from capital_grow.workspace where id=1 for update');
  phase='validation data';
  const s=await readCloudImportStore(),leadCount=s.leads.length,batchCount=s.batches.length,operationCount=s.operations?.length??0;
  s.audit=[];
  phase='duplicate and series recheck';
  const result=await fn(s);
  if(s.batches.length===batchCount)return result;
  phase='reserve filename';
  const operations=(s.operations??[]).slice(operationCount);
  for(const record of operations)if(record.file.trim())await cloudQuery(
   'insert into capital_grow.file_reservations(normalized_name,operation_id) values(lower(btrim($1)),$2) on conflict do nothing',[record.file,record.id]);
  // Stream bounded parameter chunks instead of one multi-megabyte pooler message.
  const incoming=s.leads.slice(leadCount),batch=s.batches[0];
  const validRows=batch.rows.filter(row=>row.state==='Valid');
  // Raw source cells already exist in the batch. Reattach them in Postgres.
  const compact=incoming.length===validRows.length&&incoming.every((lead,i)=>lead.custom===validRows[i].raw);
  const leads=compact?incoming.map(({custom,...lead})=>{void custom;return lead;}):incoming;
  const payload=JSON.stringify([leads,[batch],operations,s.audit,compact]);
  const needsStaging=Buffer.byteLength(payload)>96000;
  if(needsStaging){
   phase='prepare import staging';
   await cloudQuery('create temporary table cg_import_chunks (part integer primary key, body text not null) on commit drop');
   phase='transfer import rows';
   let part=0;
   for(let start=0;start<payload.length;){
    let end=Math.min(start+96000,payload.length);
    if(end<payload.length&&/[\uD800-\uDBFF]/.test(payload[end-1]))end--;
    await cloudQuery('insert into pg_temp.cg_import_chunks(part,body) values($1,$2)',[part++,payload.slice(start,end)]);
    start=end;
   }
  }
  phase='apply import';
  // Rewriting the workspace JSON and its snapshot can exceed the normal read deadline.
  await cloudQuery("set local statement_timeout = '70s'");
  const deltaSource=needsStaging?"select string_agg(body,'' order by part)::jsonb as delta from pg_temp.cg_import_chunks":'select $1::jsonb as delta';
  await cloudImportWrite(`with staged as (
    ${deltaSource}
   ), restored as (
    select delta,case when (delta->>4)::boolean then coalesce((
     select jsonb_agg(lead||jsonb_build_object('custom',raw) order by ord)
     from jsonb_array_elements(delta->0) with ordinality as l(lead,ord)
     join (select item->'raw' as raw,row_number() over(order by n) as rn
      from jsonb_array_elements(delta#>'{1,0,rows}') with ordinality as r(item,n)
      where item->>'state'='Valid') r on rn=ord
    ),'[]'::jsonb) else delta->0 end as leads from staged
   )
    update capital_grow.workspace set payload=payload||jsonb_build_object(
     'leads',coalesce(payload->'leads','[]'::jsonb)||leads,
     'batches',(delta->1)||coalesce(payload->'batches','[]'::jsonb),
     'operations',coalesce(payload->'operations','[]'::jsonb)||(delta->2),
     'audit',(delta->3)||coalesce(payload->'audit','[]'::jsonb)),
     revision=revision+1,updated_at=now() from restored where id=1`,needsStaging?[]:[payload]);
  phase='save import version';
  await cloudImportWrite(`insert into capital_grow.workspace_versions(revision,payload,source_hash)
   select revision,payload,source_hash from capital_grow.workspace where id=1`);
  phase='commit';
  return result;
 },alternate);}catch(error){
  if(isTransientDatabaseError(error)||(error as {code?:string})?.code||/timeout/i.test(error instanceof Error?error.message:''))console.warn(`Import database operation interrupted: ${phase} (${(error as {code?:string})?.code||error instanceof Error&&error.name||'unknown'})`);
  throw error;
 }
}
export async function readCloudSource(){const {rows}=await cloudQuery('select s.hash,s.content from capital_grow.source_workbooks s join capital_grow.workspace w on w.source_hash=s.hash where w.id=1');if(!rows[0])throw new Error('The source workbook is not imported.');return {hash:String(rows[0].hash),buffer:rows[0].content as Buffer}}
export async function saveCloudSource(buffer:Buffer){const hash=createHash('sha256').update(buffer).digest('hex');await cloudQuery('insert into capital_grow.source_workbooks(hash,content) values($1,$2) on conflict do nothing',[hash,buffer]);await cloudQuery('update capital_grow.workspace set source_hash=$1 where id=1',[hash]);return hash}
export async function securityEvent(actor:string|null,event:string,details:Record<string,unknown>={}){if(cloudEnabled())await cloudQuery('insert into capital_grow.security_events(actor_id,event,details) values($1,$2,$3)',[actor,event,details])}
export async function rateLimit(key:string,max:number,seconds:number){if(!cloudEnabled())return;const {rows}=await cloudQuery(`insert into capital_grow.rate_limits(key,window_start,count) values($1,now(),1) on conflict(key) do update set count=case when capital_grow.rate_limits.window_start < now()-make_interval(secs=>$2) then 1 else capital_grow.rate_limits.count+1 end, window_start=case when capital_grow.rate_limits.window_start < now()-make_interval(secs=>$2) then now() else capital_grow.rate_limits.window_start end returning count`,[key,seconds]);if(rows[0].count>max)throw new Error('Too many requests. Please wait and try again.');}
