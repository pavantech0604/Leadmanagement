import {useCloudStorage} from './deployment';
import {readCloudStore,mutateCloudStore} from './cloud-database';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Store} from './types';
import {writeSnapshot} from './backups';
const file=process.env.WORKSPACE_FILE||path.join(process.cwd(),'data','workspace.json');
export function seed():Store{
 const branches=[{id:'blr',name:'Bengaluru',company:'Acme Financial',code:'BLR',city:'Karnataka',manager:'Priya Sharma',active:true},{id:'chn',name:'Chennai',company:'Acme Financial',code:'CHN',city:'Tamil Nadu',manager:'Arjun Kumar',active:true},{id:'hyd',name:'Hyderabad',company:'Horizon Services',code:'HYD',city:'Telangana',manager:'Meera Reddy',active:true}];
 const names=['Alex Morgan','Priya Sharma','Arjun Kumar','Meera Reddy','Kavya Rao','Rahul Verma','Sneha Patel','Vikram Singh','Ananya Iyer','Rohan Das'];
 const users=names.map((name,i)=>({id:`u${i}`,name,email:`${name.split(' ')[0].toLowerCase()}@branchflow.demo`,role:(i===0?'Admin':i<4?'Manager':i<6?'Team Leader':'Employee') as Store['users'][number]['role'],branchIds:i===0?branches.map(b=>b.id):[branches[(i-1)%3].id],team:`team${(i-1)%3}`}));
 const languages=['English','Hindi','Tamil','Telugu','Malayalam','Kannada','Unassigned'];const vendors=['LeadBridge','Connect360','Growth Partners'];
 const customers=['Aarav Mehta','Diya Nair','Aditya Rao','Ishita Sharma','Karthik Reddy','Nisha Patel','Ravi Kumar','Sana Khan','Arjun Menon','Anjali Iyer','Dev Shah','Pooja Verma'];
 const states=['New','Assigned','Contacted','Interested','Follow-up','Converted','New','Not reachable','Dead'];
 const now=new Date();const leads=Array.from({length:500},(_,i)=>{const date=new Date(now);date.setDate(date.getDate()-i%30);const employee=users[6+i%4];const branchId=i%4===0?'blr':employee.branchIds[0];return {id:`L${String(i+1001)}`,name:customers[i%12]+(i>11?` ${Math.floor(i/12)+1}`:''),phone:`+9198765${String(10000+i)}`,originalPhone:`98765${10000+i}`,email:`customer${i+1}@example.com`,language:languages[i%6],branchId,vendor:vendors[i%3],status:states[i%9],assignedTo:i%7===0?'':employee.id,createdAt:date.toISOString(),followUp:i%9===4?new Date(now.getTime()+((i%5)-2)*86400000).toISOString().slice(0,16):'',notes:[],history:[{action:'Lead received from vendor',at:date.toISOString(),by:'Alex Morgan'}],custom:{}}});
 return {users,branches,vendors,languages,leads,batches:[],audit:[]};
}
export async function readStore():Promise<Store>{if(useCloudStorage())return readCloudStore();try{return JSON.parse(await fs.readFile(file,'utf8'))}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;const s=seed();await save(s);return s}}
async function save(s:Store){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify(s));await fs.rename(file+'.tmp',file)}
// Share the queue across route bundles and development reloads in this process.
const storeQueues=globalThis as typeof globalThis&{__capitalGrowStoreQueues?:Map<string,Promise<void>>};
storeQueues.__capitalGrowStoreQueues??=new Map();
export function mutate<T>(fn:(s:Store)=>T|Promise<T>):Promise<T>{if(useCloudStorage())return mutateCloudStore(fn);const queues=storeQueues.__capitalGrowStoreQueues!;const task=(queues.get(file)||Promise.resolve()).then(async()=>{const s=await readStore();const before=JSON.stringify(s);const result=await fn(s);if(JSON.stringify(s)!==before){await writeSnapshot(s,{jsonOnly:true});await save(s)}return result});queues.set(file,task.then(()=>{},()=>{}));return task}
