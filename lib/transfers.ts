import {useCloudStorage} from './deployment';
import {readCloudSource} from './cloud-database';
import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import * as XLSX from 'xlsx';
import {poolMap,mergePoolAppends} from './pool-append';
import {receiptMetadata} from './sheet-source';
import {rememberSourceReceipts,hasCachedSourceReceipts} from './master-cache';
import {makeOperation} from './operations';
import type {Store,User} from './types';
import {canTransfer} from './permissions';
export {canTransfer} from './permissions';

export type TransferInput={floor:string;requests:{language:string;quantity:number;start?:number}[];initialFile?:string;mode?:'fresh'|'reuse';reuseAcknowledged?:boolean};
export type Transfer={id:string;operationId:string;key:string;requestHash:string;floor:string;file:string;status:'committed';sourceHash:string;at:string;by:string;userId:string;quantity:number;allocations:{language:string;start:number;end:number}[];artifact:string;mode?:'fresh'|'reuse';reusedLeads?:number;previousDeliveries?:DeliveryHistory[]};
export type DeliveryHistory={id:string;language:string;floor:string;date:string;file:string;start:number;end:number;count:number};
export type FloorUsageItem={floor:string;maxEnd:number;count:number;lastRange:string};
export type TransferPreviewRow={language:string;source:string;quantity:number;previousRange:string;start:number|null;end:number|null;available:number;problems:string[];recommendedStart?:number;lastAllocatedEnd?:number;lastAllocatedFloor?:string;floorMaxEnd?:number;floorUsage?:FloorUsageItem[];totalPoolRows?:number;reusedCount?:number;sameFloorCount?:number;deliveryHistory?:DeliveryHistory[]};
export type TransferPreview={floor:string;previousFile:string;file:string;fileNeedsInput:boolean;warnings:string[];errors:string[];rows:TransferPreviewRow[];quantity:number;token:string;sourceHash:string;calculatedAt:string};
export type Pools={hash:string;rows:Record<string,unknown[][]>};
export class TransferError extends Error{constructor(message:string,public status=409){super(message)}}
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const same=(a:string,b:string)=>a.trim().toLowerCase()===b.trim().toLowerCase();
function fileSequence(file:string){const extension=file.match(/\.[a-zA-Z][a-zA-Z0-9]{0,9}$/)?.[0]||'';const stem=extension?file.slice(0,-extension.length):file;const m=stem.match(/^(.*?)(\d+)([^\d]*)$/);return m?{pattern:(m[1]+'#'+m[3]+extension).toLowerCase(),number:Number(m[2])}:null}
export function orderedDispatches(s:Store,floor?:string){return (s.operations||[]).filter(r=>r.kind==='dispatch'&&(!floor||same(r.floor,floor))).reverse().sort((a,b)=>{
 // Source-row order is the only entry-order evidence in the legacy register.
 if(a.sourceSheet==='UPDATE'&&b.sourceSheet==='UPDATE')return b.sourceRow-a.sourceRow;
 if(a.sourceSheet==='UPDATE')return 1;if(b.sourceSheet==='UPDATE')return -1;
 // Stable sorting retains reverse append order when commits share a timestamp.
 return b.createdAt.localeCompare(a.createdAt);
})}
export function incrementFile(file:string){
 const extension=file.match(/\.[a-zA-Z][a-zA-Z0-9]{0,9}$/)?.[0]||'';
 const stem=extension?file.slice(0,-extension.length):file;
 // A calendar date alone is not a file sequence.
 if(/\d{4}[-_]\d{2}[-_]\d{2}$/.test(stem)||/^\d{6,8}$/.test(stem))return null;
 const m=stem.match(/^(.*?)(\d+)([^\d]*)$/);if(!m||!m[1].trim())return null;
 const n=Number(m[2]);if(!Number.isSafeInteger(n)||n>=Number.MAX_SAFE_INTEGER)return null;
 return m[1]+String(n+1).padStart(m[2].length,'0')+m[3]+extension;
}
// Filenames must reject ASCII control characters as well as reserved path characters.
// eslint-disable-next-line no-control-regex
function validFile(file:string){return file.length<=180&&!!file.trim()&&!/[<>:"/\\|?*\x00-\x1f]/.test(file)&&!/[. ]$/.test(file)&&!/^\./.test(file)&&! /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(file)&&/\.xlsx$/i.test(file)}
const poolCache=globalThis as typeof globalThis&{__cgPoolCache?:{signature:string;pools:Pools}};
export async function loadBasePools():Promise<Pools>{
 const cloud=useCloudStorage()?await readCloudSource():null;
 const file=process.env.TRANSFER_SOURCE_PATH||'data/source/capital-grow.xlsx';
 const stat=cloud?null:await fs.stat(file).catch(()=>{throw new TransferError('Source workbook is missing. Refresh the Google Sheet before transferring.',400)});
 const signature=cloud?`cloud:${cloud.hash}`:`${file}:${stat!.mtimeMs}:${stat!.size}`;
 if(poolCache.__cgPoolCache?.signature===signature&&hasCachedSourceReceipts())return poolCache.__cgPoolCache.pools;
 const buffer=cloud?.buffer||await fs.readFile(file),w=XLSX.read(buffer,{type:'buffer',cellDates:false});
 rememberSourceReceipts(receiptMetadata(w));
 const rows:Record<string,unknown[][]>={};for(const [language,pool] of Object.entries(poolMap))if(w.Sheets[pool.sheet])rows[language]=XLSX.utils.sheet_to_json<unknown[]>(w.Sheets[pool.sheet],{header:1,raw:true,defval:'',blankrows:true});
 const pools={hash:createHash('sha256').update(buffer).digest('hex'),rows};poolCache.__cgPoolCache={signature,pools};return pools;
}
export async function loadPools(s?:Store):Promise<Pools>{const base=await loadBasePools();if(!s?.batches.some(b=>b.poolAppends?.length))return base;const rows=mergePoolAppends(base.rows,s);return {rows,hash:hash({base:base.hash,appends:s.batches.filter(b=>b.poolAppends?.length).map(b=>({id:b.id,rows:b.poolAppends}))})}}

function eligible(cells:unknown[]|undefined,language:string,row:number){const pool=poolMap[language];if(!pool||!cells)return false;const name=String(cells[pool.name]??'').trim(),phone=String(cells[pool.phone]??'').trim();return !!name&&!!phone&&!(row===1&&/^(name|last name)$/i.test(name))}
export function previewTransfer(s:Store,input:TransferInput,pools:Pools):TransferPreview{
 const floor=input.floor.trim();const errors:string[]=[],warnings:string[]=[];
 const history=orderedDispatches(s,floor),previousFile=history.find(r=>r.file.trim())?.file||'';
 let generated=previousFile?incrementFile(previousFile):null;
 if(generated&&!validFile(generated))generated=null;
 const previousSequence=fileSequence(previousFile);
 const higher=previousSequence&&history.some(r=>{const v=fileSequence(r.file);return v?.pattern===previousSequence.pattern&&v.number>previousSequence.number});
 if(higher){generated=null;warnings.push('Legacy file numbers are out of order. Enter an explicit new sequence starting above every used number, or use a new prefix.');}
 const file=generated||input.initialFile?.trim()||'';
 if(!generated&&previousFile)warnings.push('Previous file has an unsupported sequence. Enter an explicit starting filename; subsequent files will follow that rule.');
 if(!generated&&!file)errors.push('Enter the first file name for this sequence.');
 if(file&&!validFile(file))errors.push('Use a safe .xlsx file name, up to 180 characters.');
 if(file&&!incrementFile(file))errors.push('The file name must include a numeric sequence, such as your-prefix-001.xlsx.');
 const selectedSequence=fileSequence(file);
 if(!generated&&selectedSequence&&history.some(r=>{const v=fileSequence(r.file);return v?.pattern===selectedSequence.pattern&&v.number>=selectedSequence.number}))errors.push('The starting number must be higher than every used number in this filename pattern.');
 // Global uniqueness makes the downloaded artifact name unambiguous.
 if(file&&((s.operations||[]).some(r=>same(r.file,file))||(s.transfers||[]).some(t=>same(t.file,file))))errors.push('This file name has already been used. Resolve the numbering sequence before continuing.');
 if(history.some((r,i)=>i>0&&r.date>history[i-1].date))warnings.push('Legacy dates are out of order. Continuation uses register entry order, not the business date.');
 if(!floor)errors.push('Choose a destination floor.');
 const ledger=orderedDispatches(s);
 const rows=input.requests.map(request=>{
  const {language,quantity}=request,pool=poolMap[language],data=pools.rows[language];const problems:string[]=[];
  const preceding=history.find(r=>r.segments.some(seg=>seg.language===language));
  const previous=preceding?.segments.filter(seg=>seg.language===language)||[];
  const previousRange=previous.map(seg=>seg.range).join(' + ');
  const unresolved=ledger.find(r=>r.segments.some(seg=>seg.language===language&&seg.count===null));
  if(unresolved&&input.mode!=='reuse')problems.push(`Historical range in ${unresolved.file||unresolved.floor} is unresolved. Correct it before allocating this language.`);
  const knownEnds=previous.map(seg=>seg.end).filter((v):v is number=>v!==null);
  if(input.mode!=='reuse'&&previous.some(seg=>seg.count===null||seg.end===null))problems.push('Previous range is unresolved. Correct that register entry before continuing.');
  if(input.mode!=='reuse'&&(previous.some(seg=>seg.missingCount||seg.headerCount)||preceding&&preceding.actualCount==null))problems.push('Previous transfer has unresolved source rows. Review it before advancing.');
  const occupied=new Map<number,string>();
  const allHistory:DeliveryHistory[]=[];
  const reused=new Set<number>(),sameFloor=new Set<number>();
  const linkedTransfers=new Set(ledger.map(r=>r.transferId).filter(Boolean));
  const linkedOperations=new Set(ledger.map(r=>r.id));
  const floorMap=new Map<string,{floor:string;maxEnd:number;count:number;lastRange:string}>();
  let maxGlobalEnd=0,lastAllocatedFloor='';
  for(const r of ledger)for(const seg of r.segments)if(seg.language===language&&seg.start!==null&&seg.end!==null&&seg.count!==null){
    const fn=r.floor||'Other Floor';
    allHistory.push({id:r.id,language,floor:fn,date:r.date,file:r.file,start:seg.start,end:seg.end,count:seg.end-seg.start+1});
    const fm=floorMap.get(fn)||{floor:fn,maxEnd:0,count:0,lastRange:''};
    if(seg.end>fm.maxEnd){fm.maxEnd=seg.end;fm.lastRange=seg.range}
    fm.count+=(seg.matchedCount??seg.count??0);
    floorMap.set(fn,fm);
    if(seg.end>maxGlobalEnd){maxGlobalEnd=seg.end;lastAllocatedFloor=fn}
    for(let n=seg.start;n<=Math.min(seg.end,data?.length||0);n++)occupied.set(n,fn);
  }
  for(const t of (s.transfers||[]).filter(t=>!linkedTransfers.has(t.id)&&!linkedOperations.has(t.operationId)))for(const allocation of t.allocations)if(allocation.language===language){
    const fn=t.floor||'Other Floor';
    allHistory.push({id:t.id,language,floor:fn,date:t.at.slice(0,10),file:t.file,start:allocation.start,end:allocation.end,count:allocation.end-allocation.start+1});
    const fm=floorMap.get(fn)||{floor:fn,maxEnd:0,count:0,lastRange:''};
    if(allocation.end>fm.maxEnd){fm.maxEnd=allocation.end;fm.lastRange=`${allocation.start}-${allocation.end}`}
    fm.count+=(allocation.end-allocation.start+1);
    floorMap.set(fn,fm);
    if(allocation.end>maxGlobalEnd){maxGlobalEnd=allocation.end;lastAllocatedFloor=fn}
    for(let n=allocation.start;n<=Math.min(allocation.end,data?.length||0);n++)occupied.set(n,fn);
  }
  const floorUsage=Array.from(floorMap.values()).sort((a,b)=>b.maxEnd-a.maxEnd);
  let available=0,first:number|null=null;
  if(data)for(let n=1;n<=data.length;n++)if(eligible(data[n-1],language,n)&&(input.mode==='reuse'||!occupied.has(n))){available++;first??=n}
  const recommendedStart=maxGlobalEnd>0?maxGlobalEnd+1:(first??1);
  const floorMaxEnd=knownEnds.length?Math.max(...knownEnds):0;
  const floorCandidate=floorMaxEnd>0?floorMaxEnd+1:null;
  const start=request.start??(input.mode==='reuse'?null:(floorCandidate??recommendedStart));
  const end=start===null?null:start+quantity-1;
  if(!pool||!data)problems.push('Language source sheet is missing.');
  if(available<quantity)problems.push(`Only ${available} eligible leads remain; ${quantity} requested.`);
  if(start===null)problems.push(input.mode==='reuse'?'Choose a previous delivery or enter a starting row to reuse.':'No eligible starting row found.');
  if(start!==null&&end!==null){let missing=0,used=0;const conflictingFloors=new Set<string>();for(let n=start;n<=end;n++){if(!eligible(data?.[n-1],language,n))missing++;if(occupied.has(n)){used++;conflictingFloors.add(occupied.get(n)!)}}if(missing)problems.push(`${missing} rows are blank, headers or outside the source. No rows will be skipped.`);if(used&&input.mode!=='reuse')problems.push(`${used} rows were already dispatched to a floor${conflictingFloors.size?` (${Array.from(conflictingFloors).join(', ')})`:''}. No overlaps are allowed.`);}
  const deliveryHistory=start!==null&&end!==null?allHistory.filter(h=>h.start<=end&&h.end>=start).map(h=>({...h,start:Math.max(start,h.start),end:Math.min(end,h.end),count:Math.min(end,h.end)-Math.max(start,h.start)+1})).sort((a,b)=>b.date.localeCompare(a.date)||a.floor.localeCompare(b.floor)):[];
  for(const h of deliveryHistory)for(let n=h.start;n<=h.end;n++){reused.add(n);if(same(h.floor,floor))sameFloor.add(n)}
  if(reused.size&&input.mode==='reuse'){
   warnings.push(`${language}: ${reused.size} leads were delivered before${sameFloor.size?`; ${sameFloor.size} already went to ${floor}`:''}. Review delivery history before confirming.`);
   if(!input.reuseAcknowledged)problems.push('Acknowledge the previous delivery history before reusing these leads.');
  }
  if(unresolved&&input.mode==='reuse')warnings.push(`${language}: ${unresolved.file||unresolved.floor} has an unresolved historical range. Its overlap cannot be checked.`);
  return {language,source:pool?.sheet||'Unknown',quantity,previousRange,start,end,available,problems,recommendedStart,lastAllocatedEnd:maxGlobalEnd,lastAllocatedFloor,floorMaxEnd,floorUsage,totalPoolRows:data?.length||0,reusedCount:reused.size,sameFloorCount:sameFloor.size,deliveryHistory};
 });
 for(const row of rows)errors.push(...row.problems.map(p=>`${row.language}: ${p}`));
 if(new Set(input.requests.map(r=>r.language)).size!==input.requests.length)errors.push('Select each language only once.');
 const quantity=input.requests.reduce((n,r)=>n+r.quantity,0);if(quantity>10000)errors.push('A transfer can contain at most 10,000 leads.');
 const token=hash({floor,file,rows,mode:input.mode||'fresh',reuseAcknowledged:!!input.reuseAcknowledged,sourceHash:pools.hash,ledger:ledger.map(r=>({id:r.id,file:r.file,segments:r.segments,updatedAt:r.updatedAt})),transfers:(s.transfers||[]).map(t=>t.id)});
 return {floor,previousFile,file,fileNeedsInput:!generated,warnings,errors,rows,quantity,token,sourceHash:pools.hash,calculatedAt:new Date().toISOString()};
}
export function transferRequestHash(input:TransferInput){return hash(input)}
export function replayTransfer(s:Store,u:User,key:string,input:TransferInput){const existing=s.transfers?.find(t=>t.key===key);if(!existing)return null;if(existing.userId!==u.id||existing.requestHash!==transferRequestHash(input))throw new TransferError('This retry key belongs to a different transfer.');return existing}
export function commitTransfer(s:Store,u:User,input:TransferInput,pools:Pools,token:string,key:string){
 if(!canTransfer(u))throw new TransferError('Permission denied',403);
 const replay=replayTransfer(s,u,key,input);if(replay)return {transfer:replay,replayed:true};
 const plan=previewTransfer(s,input,pools);
 if(plan.errors.length)throw new TransferError(plan.errors.join(' '));
 if(plan.token!==token)throw new TransferError('The source or transfer history changed. Review a fresh preview before confirming.');
 const at=new Date().toISOString(),id=randomUUID();
 const raw={DATE:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),NAME:plan.floor,LANG:plan.rows.map(r=>r.language).join('+'),RANGE:plan.rows.map(r=>`${r.start}-${r.end}`).join(' + '),'FILE NAME':plan.file};
 const record=makeOperation('dispatch',raw,0,'Smart transfer');record.id=randomUUID();record.transferId=id;record.actualCount=plan.quantity;
 record.segments.forEach((seg,i)=>{seg.matchedCount=plan.rows[i].quantity;seg.missingCount=0;seg.headerCount=0});
 record.deliveryMode=input.mode||'fresh';record.reusedLeads=plan.rows.reduce((n,r)=>n+(r.reusedCount||0),0);
 record.notes=`${record.reusedLeads} previously delivered leads; mode ${record.deliveryMode}. Committed transfer ${id} by ${u.name} at ${at}`;
 const workbook=XLSX.utils.book_new();
 for(const row of plan.rows){const pool=poolMap[row.language];const selected=[];for(let n=row.start!;n<=row.end!;n++)selected.push({'SOURCE SHEET':pool.sheet,'SOURCE ROW':n,NAME:String(pools.rows[row.language][n-1][pool.name]),PHONE:String(pools.rows[row.language][n-1][pool.phone])});XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(selected),row.language)}
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet([{ID:id,FLOOR:plan.floor,FILE:plan.file,COUNT:plan.quantity,OPERATOR:u.name,TIME:at,STATUS:'committed',MODE:record.deliveryMode,'REUSED LEADS':record.reusedLeads,'SOURCE HASH':pools.hash}]),'Transfer details');
 if(plan.rows.some(r=>r.deliveryHistory?.length))XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(plan.rows.flatMap(r=>(r.deliveryHistory||[]).map(h=>({LANGUAGE:h.language,FLOOR:h.floor,DATE:h.date,FILE:h.file,'START ROW':h.start,'END ROW':h.end,LEADS:h.count})))),'Previous deliveries');
 const artifact=Buffer.from(XLSX.write(workbook,{type:'buffer',bookType:'xlsx',compression:true})).toString('base64');
 const transfer:Transfer={mode:input.mode||'fresh',reusedLeads:record.reusedLeads,previousDeliveries:plan.rows.flatMap(r=>r.deliveryHistory||[]),id,operationId:record.id,key,requestHash:transferRequestHash(input),floor:plan.floor,file:plan.file,status:'committed',sourceHash:pools.hash,at,by:u.name,userId:u.id,quantity:plan.quantity,allocations:plan.rows.map(row=>({language:row.language,start:row.start!,end:row.end!})),artifact};
 s.operations??=[];s.operations.push(record);s.transfers??=[];s.transfers.push(transfer);
 s.audit.unshift({id:randomUUID(),at,by:u.name,role:u.role,action:'Floor transfer committed',old:null,next:{id,floor:transfer.floor,file:transfer.file,quantity:transfer.quantity,allocations:transfer.allocations,mode:transfer.mode,reusedLeads:transfer.reusedLeads,previousDeliveries:transfer.previousDeliveries,sourceHash:pools.hash}});
 return {transfer,replayed:false};
}
export function publicTransfer(t:Transfer){const {artifact:_artifact,key:_key,requestHash:_requestHash,...publicFields}=t;return publicFields}
