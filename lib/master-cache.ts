import {useCloudStorage} from './deployment';
import fs from 'node:fs/promises';
import {fetchOperationsWorkbook} from './sheet-source';
import type {Store} from './types';
import type {Operation} from './operations';
const globalCache=globalThis as typeof globalThis&{__cgMasterRefresh?:{attempt:number;pending?:Promise<void>;error?:string;receipts?:Operation[]}};
export function cachedSourceReceipts(){return globalCache.__cgMasterRefresh?.receipts||[];}
export function hasCachedSourceReceipts(){return globalCache.__cgMasterRefresh?.receipts!==undefined;}
export function rememberSourceReceipts(receipts:Operation[]){const state=globalCache.__cgMasterRefresh??={attempt:0};state.receipts=receipts;}
export async function refreshMasterInBackground(s:Store){
 const state=globalCache.__cgMasterRefresh??={attempt:0};
 if(state.pending)return state.pending;
 const stat=useCloudStorage()?null:await fs.stat('data/source/capital-grow.xlsx').catch(()=>null);
 if(useCloudStorage()&&Date.now()-state.attempt<5*60_000)return;
 if(stat&&Date.now()-stat.mtimeMs<5*60_000||Date.now()-state.attempt<60_000)return;
 state.attempt=Date.now();
 state.pending=fetchOperationsWorkbook(s).then(records=>{state.error=undefined;state.receipts=records.filter(r=>r.kind==='receipt');}).catch(()=>{state.error='Google refresh is unavailable. The last saved master is being used.';}).finally(()=>{state.pending=undefined;});
 return state.pending;
}
