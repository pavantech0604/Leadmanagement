import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {commitTransfer,previewTransfer,type Pools} from '../lib/transfers';
test('serialized commits prevent concurrent collisions; failed backup rolls back transfer and key',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cg-transfers-'));process.env.WORKSPACE_FILE=path.join(root,'workspace.json');process.env.BACKUP_DIRECTORY=path.join(root,'backups');
 try{const {mutate,readStore}=await import('../lib/store');await mutate(s=>{s.operations=[];s.transfers=[]});const s=await readStore(),u=s.users[0];const pools:Pools={hash:'v1',rows:{Telugu:[['Name','','','Phone'],...Array.from({length:8},(_,i)=>['Test '+i,'','',String(9000000000+i)])]}};const input={floor:'Test Floor',requests:[{language:'Telugu',quantity:2}],initialFile:'test-001.xlsx'};const p=previewTransfer(s,input,pools);
 const results=await Promise.allSettled([mutate(s=>commitTransfer(s,u,input,pools,p.token,crypto.randomUUID())),mutate(s=>commitTransfer(s,u,input,pools,p.token,crypto.randomUUID()))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const saved=await readStore();assert.equal(saved.transfers!.length,1);assert.equal(saved.operations!.length,1);
 const before=await fs.readFile(process.env.WORKSPACE_FILE!,'utf8');const blocked=path.join(root,'blocked');await fs.writeFile(blocked,'file');process.env.BACKUP_DIRECTORY=blocked;const fresh=previewTransfer(saved,input,pools),key=crypto.randomUUID();await assert.rejects(mutate(s=>commitTransfer(s,u,input,pools,fresh.token,key)),/Backup/);assert.equal(await fs.readFile(process.env.WORKSPACE_FILE!,'utf8'),before);assert.equal((await readStore()).transfers!.some(t=>t.key===key),false);
 process.env.BACKUP_DIRECTORY=path.join(root,'backups');const retry=await mutate(s=>commitTransfer(s,u,input,pools,fresh.token,key));assert.equal(retry.transfer.file,'test-002.xlsx');const snapDirs=await fs.readdir(process.env.BACKUP_DIRECTORY!);const last=snapDirs.sort().at(-1)!;const restored=JSON.parse(await fs.readFile(path.join(process.env.BACKUP_DIRECTORY!,last,'workspace.json'),'utf8'));assert.equal(restored.transfers.length,2);assert.ok(restored.transfers.every((t:{artifact:string})=>t.artifact));
 }finally{delete process.env.WORKSPACE_FILE;delete process.env.BACKUP_DIRECTORY;await fs.rm(root,{recursive:true,force:true})}
});
