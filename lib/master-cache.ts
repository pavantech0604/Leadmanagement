import {useCloudStorage} from './deployment';
import fs from 'node:fs/promises';
import {fetchOperationsWorkbook} from './sheet-source';
import {reconcileGoogleRegisters} from './register-reconciliation';
import type {Store} from './types';
import type {Operation} from './operations';
const globalCache=globalThis as typeof globalThis&{__cgMasterRefresh?:{attempt:number;pending?:Promise<void>;error?:string;receipts?:Operation[]}};
export function cachedSourceReceipts(){return globalCache.__cgMasterRefresh?.receipts||[];}
export function hasCachedSourceReceipts(){return globalCache.__cgMasterRefresh?.receipts!==undefined;}
export function rememberSourceReceipts(receipts:Operation[]){const state=globalCache.__cgMasterRefresh??={attempt:0};state.receipts=receipts;}
export function masterRefreshStatus(){return {registerError:globalCache.__cgMasterRefresh?.error};}
export async function refreshMasterInBackground(source:Store|(()=>Promise<Store>),force=false){
 // An explicitly supplied local workbook is managed separately; never overwrite it in the background.
 if(process.env.TRANSFER_SOURCE_PATH)return;
 const state=globalCache.__cgMasterRefresh??={attempt:0};
 if(state.pending)return state.pending;
 const stat=useCloudStorage()?null:await fs.stat('data/source/capital-grow.xlsx').catch(()=>null);
 if(!force&&useCloudStorage()&&Date.now()-state.attempt<5*60_000)return;
 if(!force&&(stat&&Date.now()-stat.mtimeMs<5*60_000||Date.now()-state.attempt<60_000))return;
 state.attempt=Date.now();
 let registerRead=false;
 state.pending=(async()=>{const s=typeof source==='function'?await source():source;return fetchOperationsWorkbook(s,async records=>{
  const options={preserveMissing:true};
  const result=reconcileGoogleRegisters({...s,audit:[]},records,options);
  if(result.added||result.updated||result.moved){const {mutate}=await import('./store');await mutate(current=>reconcileGoogleRegisters(current,records,options));}
  registerRead=true;
  state.receipts=records.filter(r=>r.kind==='receipt');
 });})().then(records=>{state.error=undefined;state.receipts=records.filter(r=>r.kind==='receipt');}).catch(()=>{state.error=registerRead?'Google receipts were read. Language ranges need review before the source can refresh.':'Could not refresh Google receipts. The last saved register is still available.';}).finally(()=>{state.pending=undefined;});
 return state.pending;
}
