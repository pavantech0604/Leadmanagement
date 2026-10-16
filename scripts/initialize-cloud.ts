import fs from 'node:fs/promises';
import * as XLSX from 'xlsx';
import {cloudTransaction,cloudQuery,saveCloudSource,cloudPool} from '../lib/cloud-database';
import {useCloudStorage,databaseConnectionUrl,DeploymentError,workspaceFailure} from '../lib/deployment';
import type {Store} from '../lib/types';
async function main(){
 if(!useCloudStorage())throw Error('Set STORAGE_BACKEND=supabase, SUPABASE_DATABASE_URL and SESSION_SECRET in your private local environment.');
 databaseConnectionUrl(process.env.SUPABASE_DATABASE_URL||'');
 if(process.env.SUPABASE_DB_CA_PATH)await fs.access(process.env.SUPABASE_DB_CA_PATH).catch(()=>{throw new DeploymentError('The certificate file in SUPABASE_DB_CA_PATH does not exist. Use Copy as path on your downloaded certificate and update .env.local.');});
 const workspace=JSON.parse(await fs.readFile(process.env.WORKSPACE_FILE||'data/workspace.json','utf8')) as Store;
 const original=XLSX.read(await fs.readFile(process.env.TRANSFER_SOURCE_PATH||'data/source/capital-grow.xlsx'),{type:'buffer'});
 const sanitized=XLSX.utils.book_new();
 for(const name of ['AP','TN','KA','HI','KL','MMS LEAD REPORT']){
  if(!original.Sheets[name])throw Error(`Source worksheet missing: ${name}`);
  XLSX.utils.book_append_sheet(sanitized,original.Sheets[name],name);
 }
 workspace.leads=workspace.leads.filter(lead=>!/^L\d{4}$/.test(lead.id));
 workspace.users=workspace.users.filter(user=>['u0','u1'].includes(user.id));
 const owner=workspace.users.find(user=>user.id==='u0');if(!owner)throw Error('Workspace owner is missing.');
 owner.email='capitalgrow8651@gmail.com';owner.name='Capital Grow Owner';
 await cloudTransaction(async()=>{
  // Initialization is insert-only. Existing cloud data is never replaced.
  await cloudQuery('insert into capital_grow.workspace(id,payload) values(1,$1)',[workspace]);
  const hash=await saveCloudSource(Buffer.from(XLSX.write(sanitized,{type:'buffer',bookType:'xlsx'})));
  await cloudQuery('insert into capital_grow.workspace_versions(revision,payload,source_hash) values(0,$1,$2)',[workspace,hash]);
 });
 console.log('Private cloud workspace initialized. Existing cloud data was not overwritten.');
}
main().catch(error=>{const code=(error as {code?:string})?.code;const message=code==='23505'?'A cloud workspace already exists. Initialization will not overwrite it.':code==='ENOENT'?'A required local workspace or source file is missing. Check WORKSPACE_FILE and TRANSFER_SOURCE_PATH.':workspaceFailure(error).message;console.error('Cloud initialization failed: '+message);console.error('No existing workspace was overwritten.');process.exitCode=1}).finally(()=>{try{return cloudPool().end()}catch{return}});
