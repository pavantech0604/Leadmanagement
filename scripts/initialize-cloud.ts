import fs from 'node:fs/promises';
import * as XLSX from 'xlsx';
import {cloudTransaction,cloudQuery,saveCloudSource,cloudPool} from '../lib/cloud-database';
import {useCloudStorage} from '../lib/deployment';
import type {Store} from '../lib/types';
async function main(){
 if(!useCloudStorage())throw Error('Set STORAGE_BACKEND=supabase, SUPABASE_DATABASE_URL and SESSION_SECRET in your private local environment.');
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
main().catch(()=>{console.error('Cloud initialization failed. Check the private database connection, migrations and whether a workspace already exists. No existing workspace was overwritten.');process.exitCode=1}).finally(()=>{try{return cloudPool().end()}catch{return}});
