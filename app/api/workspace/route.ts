import {reconcileGoogleRegisters} from '@/lib/register-reconciliation';
import {cloudEnabled} from '@/lib/cloud-database';
import {workspaceFailure} from '@/lib/deployment';
import {NextRequest,NextResponse,after} from 'next/server';
import {cookies} from 'next/headers';
import {z} from 'zod';
import {runGoogleSyncQueue} from '@/lib/google-sync';
import {refreshMasterInBackground,cachedSourceReceipts} from '@/lib/master-cache';
import {readStore,mutate} from '@/lib/store';
import {session,signIn} from '@/lib/auth';
import {canSee,inspectRows,normalizePhone} from '@/lib/engine';
import {Lead,statuses,Store,User} from '@/lib/types';
import {makeOperation} from '@/lib/operations';
import {canTransfer} from '@/lib/permissions';
import {loadPools} from '@/lib/transfers';
import {nextImportSeries,importPreviewToken} from '@/lib/import-series';
import {existingPhoneIndex,inspectPoolDuplicates,planPoolAppends} from '@/lib/pool-append';
import {fetchOperationsWorkbook,resolveSavedRows} from '@/lib/sheet-source';
export const runtime='nodejs';
export const maxDuration=120;
const fail=(message:string,status=400)=>NextResponse.json({error:message},{status});
function audit(s:Store,u:User,action:string,old:unknown,next:unknown,lead?:Lead){s.audit.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),by:u.name,role:u.role,action,old,next,leadId:lead?.id,branchId:lead?.branchId})}
const workspaceJson=(body:unknown)=>NextResponse.json(body,{headers:{'Cache-Control':'private, no-store, max-age=0'}});
export async function GET(){try{const s=await readStore();const u=await session(s);if(!u)return workspaceJson({login:true,users:process.env.NODE_ENV!=='production'&&!cloudEnabled()?s.users.filter(x=>['u0','u1'].includes(x.id)):[]});if(canTransfer(u))after(()=>refreshMasterInBackground(s));return workspaceJson({user:u,users:s.users.filter(x=>u.role==='Admin'||x.branchIds.some(b=>u.branchIds.includes(b))),branches:s.branches.filter(b=>u.role==='Admin'||u.branchIds.includes(b.id)),vendors:s.vendors,languages:s.languages,leads:s.leads.filter(l=>canSee(u,l,s.users)).map(l=>({...l,custom:{}})),batches:u.role==='Employee'?[]:s.batches.filter(b=>u.role==='Admin'||(!b.branchId&&canTransfer(u))||u.branchIds.includes(b.branchId)).map(b=>({...b,poolAppends:undefined,appendRanges:b.poolAppends?.map(a=>({language:a.language,start:a.start,count:a.cells.length})),rows:b.rows.filter(r=>r.state.includes('uplicate')).map(r=>({...r,raw:{}}))})),audit:u.role==='Admin'?s.audit.slice(0,100).map(a=>({...a,old:null,next:null})):[],auditTotal:u.role==='Admin'?s.audit.length:0,operations:canTransfer(u)?s.operations||[]:[],operationsSyncAt:s.operationsSyncAt,importSeries:canTransfer(u)?nextImportSeries(s,'',cachedSourceReceipts()):undefined})}catch(error){const failure=workspaceFailure(error);console.error('Workspace storage unavailable',{name:error instanceof Error?error.name:'Error',code:(error as {code?:string})?.code});return fail(failure.message,failure.status)}}
const limits=new Map<string,{count:number;at:number}>();
export async function POST(req:NextRequest){try{
 const origin=req.headers.get('origin');if(origin&&new URL(origin).host!==req.headers.get('host'))return fail('Invalid origin',403);
 const key=req.headers.get('x-forwarded-for')||'local';const rate=limits.get(key);if(rate&&Date.now()-rate.at<60000&&rate.count>90)return fail('Too many requests. Try again shortly.',429);limits.set(key,{at:rate&&Date.now()-rate.at<60000?rate.at:Date.now(),count:rate&&Date.now()-rate.at<60000?rate.count+1:1});
 const b=await req.json();const action=z.string().parse(b.action);
 if(action==='login'){if(process.env.NODE_ENV==='production'||cloudEnabled())return fail('Local profile login is disabled. Sign in with your authorized email and password.',403);const s=await readStore();if(!s.users.some(u=>u.id===b.userId))return fail('Unknown user');await signIn(b.userId);return NextResponse.json({ok:true})}
 if(action==='logout'){(await cookies()).delete('bf-session');return NextResponse.json({ok:true})}
 const result=await mutate(async s=>{const u=await session(s);if(!u)throw new Error('Unauthorized');const manager=u.role==='Admin'||u.role==='Manager';
 if(action.startsWith('operations-')){
 if(!canTransfer(u))throw new Error('Permission denied');s.operations??=[];
 if(action==='operations-status')return {ok:true};
 if(action==='operations-sync'){if(u.role!=='Admin')throw new Error('Permission denied');return reconcileGoogleRegisters(s,await fetchOperationsWorkbook(s));}
 if(action==='operations-save'||action==='operations-preview'){const kind=z.enum(['receipt','dispatch']).parse(b.kind);const raw=z.record(z.string(),z.string().max(1000)).parse(b.raw);let r=makeOperation(kind,raw,0,'Manual entry');if(r.issues.length)throw new Error(r.issues.join('; '));r=await resolveSavedRows(r,s);if(action==='operations-preview')return {record:r};const existing=b.id?s.operations.find(x=>x.id===b.id):undefined;if(b.id&&!existing)throw new Error('Record not found');if(existing?.sourceSheet==='Smart transfer')throw new Error('Committed transfers are immutable. Their allocations and file names cannot be edited.');if(action==='operations-save'&&kind==='dispatch'&&!existing)throw new Error('Use the smart transfer preview and confirmation to create a new floor delivery.');if(existing&&kind!==existing.kind)throw new Error('The record type cannot be changed');if(existing?.sourceSheet==='CONTACT UPLOAD')throw new Error('Upload receipts are read-only; their counts come from validated import batches');if(existing){if(kind==='dispatch'&&(s.transfers||[]).some(t=>r.segments.some(seg=>t.allocations.some(a=>a.language===seg.language&&seg.start!==null&&seg.end!==null&&seg.start<=a.end&&seg.end>=a.start))))throw new Error('Correction overlaps a committed smart transfer');const old=structuredClone(existing);Object.assign(existing,r,{id:existing.id,sourceRow:existing.sourceRow,sourceSheet:existing.sourceSheet,createdAt:existing.createdAt,notes:z.string().max(3000).parse(b.notes||''),raw:existing.raw});audit(s,u,'Daily register corrected',old,existing)}else{if(s.operations.some(x=>x.kind===r.kind&&JSON.stringify(x.raw)===JSON.stringify(r.raw)))throw new Error('This record already exists');r.id=crypto.randomUUID();r.notes=z.string().max(3000).parse(b.notes||'');s.operations.push(r);audit(s,u,'Daily register created',null,r)}return {ok:true}}
 throw new Error('Unknown operations action');
 }
 const branch=(id:string)=>{if(!s.branches.some(x=>x.id===id)||!(u.role==='Admin'||u.branchIds.includes(id)))throw new Error('Branch access denied')};
 if(action==='preview'||action==='import'){
 if(!manager)throw new Error('Permission denied');const importBranchId=z.string().max(100).parse(b.branchId||'');const importVendor=z.string().trim().max(100).parse(b.vendor||'');if(importBranchId)branch(importBranchId);else if(!canTransfer(u))throw new Error('Branch access denied');
 const raw=z.array(z.record(z.string(),z.string())).max(10000).parse(b.rows);const mapping=z.record(z.string(),z.string()).parse(b.mapping);if(!mapping.name||!mapping.phone)throw new Error('Map name and phone columns');
 const pools=await loadPools(s),index=existingPhoneIndex(pools.rows,s.leads);
 const incoming=cachedSourceReceipts();
 const rows=inspectPoolDuplicates(inspectRows(raw,mapping,b.language,s.languages,s.leads),pools.rows,s.leads,index);
 const poolAppends=planPoolAppends(rows,pools.rows),naming=nextImportSeries(s,z.string().max(180).parse(b.initialFile||''),incoming,z.string().max(240).parse(b.file||''));
 const previewToken=importPreviewToken(rows,poolAppends,naming,z.string().max(240).parse(b.file||''));
 if(action==='preview')return {rows,previewToken,naming,checkedExisting:index.size,allocations:poolAppends.map(a=>({language:a.language,start:a.start,end:a.start+a.cells.length-1,count:a.cells.length}))};
 if(!naming.file)throw new Error('Enter the first filename for your series, such as MMS-001.xlsx, and validate again.');
 if(!rows.some(r=>r.state==='Valid'))throw new Error('No new unique leads remain. No leads were added and the series was not advanced.');
 if(b.previewToken!==previewToken)throw new Error('The source leads or next series changed. Validate again to review the latest duplicate counts and ranges.');
 const at=new Date().toISOString();const batch={syncJob:{status:'pending' as const,attempts:0,updatedAt:new Date().toISOString()},poolAppends,sourceFile:z.string().min(1).max(240).parse(b.file),series:naming.series,clientId:naming.clientId,checkedExisting:index.size,id:crypto.randomUUID(),file:naming.file,branchId:importBranchId,vendor:importVendor,at,by:u.name,total:rows.length,valid:rows.filter(r=>r.state==='Valid').length,duplicates:rows.filter(r=>r.state.includes('uplicate')).length,errors:rows.filter(r=>r.state==='Error').length,rows};
 rows.filter(r=>r.state==='Valid').forEach(r=>{const lead:Lead={id:crypto.randomUUID(),name:r.name,phone:r.phone,originalPhone:r.raw[mapping.phone],email:r.email,language:r.language,branchId:importBranchId,vendor:importVendor,status:'New',assignedTo:'',createdAt:at,followUp:'',notes:[],history:[{action:`Imported from ${batch.file} (original: ${batch.sourceFile})`,at,by:u.name}],custom:r.raw};s.leads.push(lead)});s.batches.unshift(batch);if(batch.valid){s.operations??=[];const rawReceipt:Record<string,string>={DATE:at.slice(0,10),'CLIENT NAME':importVendor,'CLIENT ID':naming.clientId,'SERIES NO':naming.series,'FILE NAME':batch.file};for(const allocation of poolAppends)rawReceipt[allocation.language.toUpperCase()]=`${allocation.start}-${allocation.start+allocation.cells.length-1}`;const receipt=makeOperation('receipt',rawReceipt,0,'CONTACT UPLOAD');receipt.id=crypto.randomUUID();receipt.series=batch.id;receipt.displaySeries=naming.series;receipt.actualCount=batch.valid;receipt.issues=[];receipt.segments=poolAppends.map(a=>({language:a.language,range:`${a.start}-${a.start+a.cells.length-1}`,start:a.start,end:a.start+a.cells.length-1,count:a.cells.length,matchedCount:a.cells.length}));receipt.notes='Validated leads appended to the end of each local language sheet. Ranges identify destination rows. Duplicate and invalid rows excluded. Google Sheets sync pending. Original file: '+batch.sourceFile;s.operations.push(receipt);audit(s,u,'Upload receipt recorded',null,receipt)}audit(s,u,'Import completed',null,{batchId:batch.id,valid:batch.valid});return {batch:{id:batch.id,file:batch.file,valid:batch.valid,duplicates:batch.duplicates}};
 }
 if(action==='update'){
 const ids=z.array(z.string()).min(1).max(1000).parse(b.ids);const patch=z.object({status:z.enum(statuses).optional(),assignedTo:z.string().optional(),followUp:z.string().optional(),note:z.string().max(3000).optional()}).parse(b.patch);
 const targets=ids.map(id=>{const l=s.leads.find(x=>x.id===id);if(!l||!canSee(u,l,s.users))throw new Error('Lead access denied');return l});
 if(patch.assignedTo!==undefined){if(u.role==='Employee')throw new Error('Permission denied');const target=s.users.find(x=>x.id===patch.assignedTo);if(patch.assignedTo&&(!target||targets.some(l=>!target.branchIds.includes(l.branchId))||u.role==='Team Leader'&&target.team!==u.team))throw new Error('Employee must belong to the same branch and team')}
 if(patch.status==='Archived'&&!manager)throw new Error('Permission denied');
 for(const l of targets){const old=structuredClone(l);if(patch.status)l.status=patch.status;if(patch.assignedTo!==undefined){l.assignedTo=patch.assignedTo;if(l.status==='New'&&l.assignedTo)l.status='Assigned'}if(patch.followUp!==undefined){if(patch.followUp&&Number.isNaN(Date.parse(patch.followUp)))throw new Error('Invalid follow-up date');l.followUp=patch.followUp}const at=new Date().toISOString();if(patch.note?.trim())l.notes.push({text:patch.note.trim(),at,by:u.name});l.history.push({action:patch.note?'Note added':`Updated: ${Object.keys(patch).join(', ')}`,at,by:u.name});audit(s,u,'Lead updated',old,l,l)}return {ok:true};
 }
 if(action==='create'){
 if(!manager)throw new Error('Permission denied');const d=z.object({name:z.string().trim().min(1).max(200),phone:z.string(),email:z.string().email().or(z.literal('')),branchId:z.string(),language:z.string(),vendor:z.string()}).parse(b.lead);branch(d.branchId);const phone=normalizePhone(d.phone);if(!phone)throw new Error('Invalid phone number');if(s.leads.some(l=>l.phone===phone||d.email&&l.email===d.email.toLowerCase()))throw new Error('This phone or email already exists');if(!s.languages.includes(d.language)||!s.vendors.includes(d.vendor))throw new Error('Invalid language or vendor');const at=new Date().toISOString();const lead:Lead={...d,email:d.email.toLowerCase(),id:crypto.randomUUID(),phone,originalPhone:d.phone,status:'New',assignedTo:'',createdAt:at,followUp:'',notes:[],history:[{action:'Lead created',at,by:u.name}],custom:{}};s.leads.push(lead);audit(s,u,'Lead created',null,lead,lead);return {ok:true};
 }
 if(action==='review'){
 if(!manager)throw new Error('Permission denied');const batch=s.batches.find(x=>x.id===b.batchId);if(!batch)throw new Error('Batch not found');branch(batch.branchId);const row=batch.rows.find(r=>r.row===b.row);if(!row||!['Duplicate','Potential duplicate'].includes(row.state))throw new Error('Review already resolved');if(!['reject','merge'].includes(b.decision))throw new Error('Unknown review decision');if(b.decision==='merge'){const lead=s.leads.find(l=>l.id===row.existingId);if(!lead||!canSee(u,lead,s.users))throw new Error('Matched lead outside your permission or within the same file');const old=structuredClone(lead);lead.notes.push({text:`Additional source: ${batch.vendor} / ${batch.file}. Imported name: ${row.name}`,at:new Date().toISOString(),by:u.name});lead.history.push({action:'Duplicate source merged',at:new Date().toISOString(),by:u.name});audit(s,u,'Duplicate merged',old,lead,lead)}row.reason+=` · ${b.decision==='merge'?'Merged':'Rejected'} by ${u.name}`;row.state='Error';audit(s,u,'Duplicate review resolved',null,{batchId:batch.id,row:row.row,decision:b.decision});return {ok:true};
 }
 if(action==='setting'){
 if(u.role!=='Admin')throw new Error('Permission denied');const value=z.string().trim().min(2).max(100).parse(b.value);if(b.kind==='vendor'||b.kind==='language'){const list=b.kind==='vendor'?s.vendors:s.languages;if(list.some(x=>x.toLowerCase()===value.toLowerCase()))throw new Error('Already exists');list.push(value)}else if(b.kind==='branch'){s.branches.push({id:crypto.randomUUID(),name:value,company:z.string().trim().min(1).parse(b.company),code:value.slice(0,3).toUpperCase(),city:z.string().parse(b.city),manager:'Unassigned',active:true})}else throw new Error('Unknown setting');audit(s,u,'Setting created',null,b);return {ok:true};
 }
 throw new Error('Unknown action');});if(action==='import')after(()=>runGoogleSyncQueue());return NextResponse.json(result);
 }catch(e){const message=e instanceof Error?e.message:'Request failed';return fail(message,message==='Unauthorized'?401:message.includes('denied')?403:400)}}





