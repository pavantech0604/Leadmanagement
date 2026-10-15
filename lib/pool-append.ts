import * as XLSX from 'xlsx';
import {normalizePhone} from './engine';
import type {ImportRow,Store,Lead} from './types';

export const poolMap:Record<string,{sheet:string;name:number;phone:number}>={Telugu:{sheet:'AP',name:0,phone:3},Tamil:{sheet:'TN',name:0,phone:4},Kannada:{sheet:'KA',name:0,phone:4},Hindi:{sheet:'HI',name:0,phone:6},Malayalam:{sheet:'KL',name:0,phone:3}};
export type PoolAppend={language:string;start:number;cells:string[][]};
export const occupied=(row:unknown[])=>row.some(v=>v!==null&&v!==undefined&&String(v).trim()!=='');
export function lastOccupied(rows:unknown[][]){let end=rows.length;while(end&&!occupied(rows[end-1]||[]))end--;return end}

// Append allocations live in the same atomic save as the batch and receipt.
// A refreshed source may already contain an allocation, but must never replace it.
export function mergePoolAppends(base:Record<string,unknown[][]>,s:Pick<Store,'batches'>){
 const rows=Object.fromEntries(Object.entries(base).map(([k,v])=>[k,v.slice()]));
 for(const batch of s.batches)for(const append of batch.poolAppends||[]){
  const pool=poolMap[append.language];if(!pool)throw new Error('Unknown language allocation');
  const target=rows[append.language]??=[];
  append.cells.forEach((cells,i)=>{const index=append.start+i-1,old=target[index];
   if(old&&occupied(old)){
    if(String(old[pool.name]??'').trim().toLowerCase()!==cells[pool.name].trim().toLowerCase()||normalizePhone(String(old[pool.phone]??''))!==normalizePhone(cells[pool.phone]))throw new Error(`${pool.sheet} row ${index+1} conflicts with a saved upload. Reconcile the source sheet before continuing.`);
   }else target[index]=cells;
  });
 }
 return rows;
}
export function appendWorkbook(w:XLSX.WorkBook,s:Pick<Store,'batches'>){
 const base:Record<string,unknown[][]>={};
 for(const [language,pool] of Object.entries(poolMap))if(w.Sheets[pool.sheet])base[language]=XLSX.utils.sheet_to_json<unknown[]>(w.Sheets[pool.sheet],{header:1,raw:true,defval:'',blankrows:true});
 mergePoolAppends(base,s); // Validate all collisions before changing any sheet.
 for(const batch of s.batches)for(const append of batch.poolAppends||[]){const name=poolMap[append.language].sheet;if(!w.Sheets[name])XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([]),name);append.cells.forEach((cells,i)=>{if(!occupied(base[append.language]?.[append.start+i-1]||[]))XLSX.utils.sheet_add_aoa(w.Sheets[name], [cells],{origin:{r:append.start+i-1,c:0}})})}
 return w;
}
function phoneKey(value:string){const digits=value.replace(/\D/g,'');if(/^[6-9]\d{9}$/.test(digits))return '+91'+digits;if(/^91[6-9]\d{9}$/.test(digits))return '+'+digits;return normalizePhone(value)}
export function existingPhoneIndex(pools:Record<string,unknown[][]>,existing:Lead[]=[]){
 const phones=new Map<string,string>();
 for(const [language,cells] of Object.entries(pools)){const pool=poolMap[language];if(!pool)continue;for(let i=0;i<cells.length;i++){const phone=phoneKey(String(cells[i]?.[pool.phone]??''));if(phone&&!phones.has(phone))phones.set(phone,`${pool.sheet} row ${i+1}`)}}
 for(const lead of existing){const phone=phoneKey(lead.phone);if(phone&&!phones.has(phone))phones.set(phone,'earlier imports');}
 return phones;
}
export function inspectPoolDuplicates(rows:ImportRow[],pools:Record<string,unknown[][]>,existing:Lead[]=[],phones=existingPhoneIndex(pools,existing)){
 const seen=new Set<string>();
 for(const row of rows){
  if(row.state==='Error')continue;
  const phone=phoneKey(row.phone);row.phone=phone;
  if(phones.has(phone)){row.state='Duplicate';row.reason=`Phone already exists in ${phones.get(phone)}`;}
  else if(seen.has(phone)){row.state='Duplicate';row.reason='Repeated phone within this upload';}
  else if(!poolMap[row.language]){row.state='Error';row.reason='Choose a language with an existing destination sheet.';}
  if(row.state==='Valid')seen.add(phone);
 }
 return rows;
}
export function planPoolAppends(rows:ImportRow[],pools:Record<string,unknown[][]>):PoolAppend[]{
 const result:PoolAppend[]=[];
 for(const language of new Set(rows.filter(r=>r.state==='Valid').map(r=>r.language))){
  const pool=poolMap[language],source=pools[language];if(!pool||!source)throw new Error(`Source sheet missing for ${language}. Refresh the source workbook before uploading.`);
  const header=source[0]||[];
  const cells=rows.filter(r=>r.state==='Valid'&&r.language===language).map(r=>{
   const lookup=new Map(Object.entries(r.raw).map(([k,v])=>[k.trim().toUpperCase().replace(/[^A-Z0-9]/g,''),v]));
   const values=Array.from({length:Math.max(header.length,pool.phone+1)},(_,i)=>lookup.get(String(header[i]??'').trim().toUpperCase().replace(/[^A-Z0-9]/g,''))||'');
   values[pool.name]=r.name;values[pool.phone]=r.phone;return values;
  });
  result.push({language,start:lastOccupied(source)+1,cells});
 }
 return result;
}
