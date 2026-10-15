// Isolated integration test: never uses the user's workspace/source files.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {SignJWT} from 'jose';
import * as XLSX from 'xlsx';
const require=createRequire(import.meta.url),root=await fs.mkdtemp(path.join(os.tmpdir(),'cg-api-transfers-')),base='http://127.0.0.1:3101',secret='integration-test-secret-only-not-for-deployment';
const owner={id:'owner',name:'Test Owner',role:'Admin',email:'owner@example.com',branchIds:[],team:''},operator={...owner,id:'u1',role:'Manager',name:'Test Operator'},employee={...owner,id:'restricted',role:'Employee'};
let server,output='';
try{
 const store={users:[owner,operator,employee],branches:[],vendors:[],languages:['Telugu','Tamil'],leads:[],batches:[],audit:[],operations:[]};await fs.writeFile(path.join(root,'workspace.json'),JSON.stringify(store));
 const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['NAME','','','MOBILE NUMBER'],...Array.from({length:15},(_,i)=>['API fixture '+i,'','',String(9000000000+i)])]),'AP');await fs.writeFile(path.join(root,'source.xlsx'),Buffer.from(XLSX.write(w,{type:'buffer',bookType:'xlsx'})));
 server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--port','3101','--hostname','127.0.0.1'],{cwd:process.cwd(),env:{...process.env,SESSION_SECRET:secret,WORKSPACE_FILE:path.join(root,'workspace.json'),BACKUP_DIRECTORY:path.join(root,'backups'),TRANSFER_SOURCE_PATH:path.join(root,'source.xlsx')},windowsHide:true,stdio:['ignore','pipe','pipe']});server.stdout.on('data',x=>output+=x);server.stderr.on('data',x=>output+=x);
 let ready=false;for(let n=0;n<80;n++){try{const r=await fetch(base+'/api/transfers');if(r.status===401){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,250))}assert.ok(ready,output);
 async function cookie(id){return 'bf-session='+await new SignJWT({}).setProtectedHeader({alg:'HS256'}).setSubject(id).setExpirationTime('1h').sign(new TextEncoder().encode(secret))}
 const admin=await cookie(owner.id),second=await cookie(operator.id),restricted=await cookie(employee.id);
 async function post(body,c=admin){const r=await fetch(base+'/api/transfers',{method:'POST',headers:{Cookie:c,'Content-Type':'application/json',Origin:base},body:JSON.stringify(body)});return {status:r.status,data:await r.json()}}
 const input={floor:'Fixture floor',requests:[{language:'Telugu',quantity:3}],initialFile:'fixture-001.xlsx'};
 assert.equal((await post({action:'preview',input},restricted)).status,403);assert.equal((await post({action:'preview',input},'')).status,401);
 const p=await post({action:'preview',input});assert.equal(p.status,200);assert.equal(p.data.preview.rows[0].start,2);assert.equal(JSON.stringify(p).includes('API fixture'),false);
 const key=crypto.randomUUID(),body={action:'commit',input,key,token:p.data.preview.token};const pair=await Promise.all([post(body),post(body)]);assert.ok(pair.every(r=>r.status===200));assert.equal(pair[0].data.transfer.id,pair[1].data.transfer.id);
 const id=pair[0].data.transfer.id;assert.equal((await post(body)).data.replayed,true);
 const fresh=await post({action:'preview',input});assert.equal(fresh.data.preview.rows[0].start,5);assert.equal(fresh.data.preview.file,'fixture-002.xlsx');
 const collision=await Promise.all([post({action:'commit',input,key:crypto.randomUUID(),token:fresh.data.preview.token}),post({action:'commit',input,key:crypto.randomUUID(),token:fresh.data.preview.token},second)]);assert.deepEqual(collision.map(r=>r.status).sort(),[200,409]);
 const file=await fetch(base+`/api/transfers/${id}/file`,{headers:{Cookie:admin}});assert.equal(file.status,200);assert.ok(file.headers.get('content-disposition').includes('fixture-001.xlsx'));const exportW=XLSX.read(Buffer.from(await file.arrayBuffer()));assert.equal(XLSX.utils.sheet_to_json(exportW.Sheets.Telugu).length,3);
 assert.equal((await fetch(base+`/api/transfers/${id}/file`,{headers:{Cookie:restricted}})).status,403);assert.equal((await fetch(base+`/api/transfers/${id}/file`)).status,401);
 const history=await fetch(base+'/api/transfers?q=fixture-001',{headers:{Cookie:admin}});const h=await history.json();assert.equal(h.total,1);assert.equal(h.records[0].status,'committed');assert.equal('artifact' in h.records[0],false);
 const workspace=await(await fetch(base+'/api/workspace',{headers:{Cookie:admin}})).json();assert.equal(workspace.operations.length,2);assert.ok(workspace.audit.some(a=>a.action==='Floor transfer rejected'&&a.next.status==='failed'));assert.equal(workspace.operations.reduce((n,r)=>n+r.actualCount,0),6);
 const legacy=await fetch(base+'/api/workspace',{method:'POST',headers:{Cookie:admin,'Content-Type':'application/json',Origin:base},body:JSON.stringify({action:'operations-save',kind:'dispatch',raw:{DATE:'2026-10-12',NAME:'Other',LANG:'Telugu',RANGE:'8-10','FILE NAME':'bypass.xlsx'}})});assert.equal(legacy.status,400);
 const edit=await fetch(base+'/api/workspace',{method:'POST',headers:{Cookie:admin,'Content-Type':'application/json',Origin:base},body:JSON.stringify({action:'operations-save',id:workspace.operations[0].id,kind:'dispatch',raw:workspace.operations[0].raw})});assert.equal(edit.status,400);
 const invalid=await post({action:'preview',input:{...input,requests:[{language:'Telugu',quantity:-1}]}});assert.equal(invalid.status,400);
 await fs.unlink(path.join(root,'source.xlsx'));assert.equal((await post(body)).data.replayed,true);
 console.log('PASS: isolated production API preview, permissions, concurrent retry, conflicting commits, download, history, dashboard, immutable transfers, legacy bypass blocking and input validation.');
}finally{if(server){server.kill();await new Promise(r=>server.once('exit',r))}await fs.rm(root,{recursive:true,force:true})}
