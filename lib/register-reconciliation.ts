import type {Operation} from './operations';
import type {Store} from './types';
const sheets=new Set(['UPDATE','MMS LEAD REPORT']);
const normalized=(value:string)=>value.trim().toLowerCase();
const contentKey=(record:Operation)=>JSON.stringify([record.kind,Object.entries(record.raw).map(([key,value])=>[key.trim().toUpperCase(),String(value).trim()]).filter(([,value])=>value).sort(([a],[b])=>a.localeCompare(b))]);
const identityKey=(record:Operation)=>JSON.stringify([record.kind,normalized(record.file),record.date,normalized(record.floor),normalized(record.clientId),record.series.trim()]);
export function reconcileGoogleRegisters(s:Store,incoming:Operation[]){
 if(!incoming.some(record=>record.sourceSheet==='UPDATE')||!incoming.some(record=>record.sourceSheet==='MMS LEAD REPORT'))throw Error('Both Google registers must contain verified rows before reconciliation.');
 if(incoming.some(record=>!sheets.has(record.sourceSheet)))throw Error('Unexpected source register.');
 const protectedIds=new Set((s.transfers||[]).map(transfer=>transfer.operationId));
 const previous=s.operations||[];
 const managed=previous.filter(record=>sheets.has(record.sourceSheet)&&!protectedIds.has(record.id));
 const preserved=previous.filter(record=>!managed.includes(record));
 const used=new Set<string>();const next:Operation[]=[];
 let added=0,updated=0,moved=0;
 const changes:{before:Operation;after:Operation}[]=[];
 for(const record of incoming){
  // An upload/committed transfer already has its own authoritative application record.
  if(preserved.some(existing=>existing.kind===record.kind&&normalized(existing.file)===normalized(record.file)&&existing.file&&((existing.sourceSheet==='CONTACT UPLOAD'&&s.batches.some(batch=>batch.id===existing.series&&batch.googleSync&&batch.googleSync.series===record.series&&normalized(batch.googleSync.clientId||'')===normalized(record.clientId)))||protectedIds.has(existing.id))))continue;
  const exact=managed.find(existing=>!used.has(existing.id)&&contentKey(existing)===contentKey(record));
  const candidates=managed.filter(existing=>!used.has(existing.id)&&identityKey(existing)===identityKey(record));
  const sameFile=(value:Operation)=>value.kind===record.kind&&!!record.file&&normalized(value.file)===normalized(record.file);
  const fileCandidates=managed.filter(sameFile);
  const uniqueFile=fileCandidates.length===1&&incoming.filter(sameFile).length===1&&!used.has(fileCandidates[0].id)?fileCandidates[0]:undefined;
  const existing=exact||(candidates.length===1?candidates[0]:undefined)||uniqueFile;
  if(!existing){next.push(record);added++;continue}
  used.add(existing.id);
  if(exact){if(existing.sourceRow!==record.sourceRow)moved++;next.push({...existing,sourceRow:record.sourceRow});continue}
  const after={...record,id:existing.id,createdAt:existing.createdAt,notes:existing.notes,updatedAt:new Date().toISOString()};
  changes.push({before:existing,after});next.push(after);updated++;
 }
 const removed=managed.filter(record=>!used.has(record.id));
 // Google row order remains the entry-order reference used by floor sequences.
 s.operations=[...next,...preserved];s.operationsSyncAt=new Date().toISOString();
 if(added||updated||removed.length||moved)s.audit.unshift({id:crypto.randomUUID(),at:s.operationsSyncAt,by:'Workspace owner',role:'Admin',action:'Google registers reconciled',old:{removed,changed:changes.map(change=>change.before)},next:{added,updated,removed:removed.length,moved,changed:changes.map(change=>change.after)}});
 return {added,updated,removed:removed.length,moved,total:s.operations.length};
}
