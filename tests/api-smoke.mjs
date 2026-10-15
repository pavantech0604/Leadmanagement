import assert from 'node:assert/strict';
const base=process.env.TEST_URL||'http://localhost:3000';
async function login(userId){const r=await fetch(base+'/api/workspace',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({action:'login',userId})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]}
async function get(cookie){return (await fetch(base+'/api/workspace',{headers:{Cookie:cookie}})).json()}
async function post(cookie,body,expected=200){const r=await fetch(base+'/api/workspace',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,Origin:base},body:JSON.stringify(body)});const j=await r.json();assert.equal(r.status,expected,JSON.stringify(j));return j}
const admin=await login('u0');const before=await get(admin);assert.ok(before.leads.length>=500);
const mapping={name:'Name',phone:'Phone',email:'Email',language:'Language'};
const phone='+9191'+String(Date.now()).slice(-8);const uniqueName='QA Import '+Date.now();
const rows=[{Name:uniqueName,Phone:phone,Language:'Tamil'},{Name:uniqueName,Phone:phone,Language:'Tamil'},{Name:'Invalid',Phone:'123',Language:'Hindi'},{Name:'Different Name',Phone:before.leads[0].phone,Language:'Tamil'}];
const envelope={rows,mapping,branchId:'blr',vendor:'LeadBridge',language:'Tamil',file:'qa-import.csv',initialFile:'mmsoctm01.xlsx'};
const preview=await post(admin,{action:'preview',...envelope});assert.deepEqual(preview.rows.map(r=>r.state),['Valid','Duplicate','Error','Duplicate']);
const imported=await post(admin,{action:'import',...envelope,previewToken:preview.previewToken});assert.equal(imported.batch.valid,1);const after=await get(admin);assert.equal(after.leads.length,before.leads.length+1);const lead=after.leads.find(l=>l.name===uniqueName);
await post(admin,{action:'update',ids:[lead.id],patch:{assignedTo:'u7',status:'Follow-up',followUp:'2026-10-13T10:30',note:'QA call outcome; next action recorded'}});
const updated=await get(admin);assert.equal(updated.leads.find(l=>l.id===lead.id).notes.length,1);assert.ok(updated.auditTotal>before.auditTotal);
await post(admin,{action:'review',batchId:imported.batch.id,row:5,decision:'merge'});
await post(admin,{action:'review',batchId:imported.batch.id,row:3,decision:'reject'});
await post(admin,{action:'create',lead:{name:'Duplicate',phone,email:'',language:'English',branchId:'blr',vendor:'LeadBridge'}},400);
const employee=await login('u6');const restricted=await get(employee);assert.ok(restricted.leads.every(l=>l.assignedTo==='u6'));assert.equal(restricted.audit.length,0);
await post(employee,{action:'update',ids:[lead.id],patch:{status:'Converted'}},403);
await post(employee,{action:'import',...envelope},403);
const manager=await login('u1');const managed=await get(manager);assert.ok(managed.leads.every(l=>l.branchId==='blr'));
await post(manager,{action:'import',...envelope,branchId:'hyd'},403);
await post(admin,{action:'update',ids:[lead.id],patch:{status:'Archived'}});
console.log('PASS: login, preview, import, duplicate merge/reject, persistence, assignment, notes, audit, duplicate create blocking, employee access and manager branch isolation. QA lead archived.');
