import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {planPoolAppends,mergePoolAppends,appendWorkbook,inspectPoolDuplicates} from '../lib/pool-append';
import {seed} from '../lib/store';
import {inspectRows} from '../lib/engine';
import type {Batch} from '../lib/types';
const base={Telugu:[['NAME','PAN','PIN','MOBILE'],['Existing Telugu','','','9876543210'],[],['Last Telugu','','','9876543211'],[]],Tamil:[['NAME','PAN','STATE','PIN','PHONE'],['Existing Tamil','','TN','','9876543212']]};
function inputs(){return inspectRows([{Name:'New Telugu',Phone:'9876543220',State:'AP'},{Name:'New Tamil',Phone:'9876543221',State:'TN'},{Name:'Another Tamil',Phone:'9876543222',State:'TN'}],{name:'Name',phone:'Phone',state:'State'},'',seed().languages,[])}
function batch(appends:ReturnType<typeof planPoolAppends>){return {id:'test',poolAppends:appends} as Batch}
test('mixed upload appends independently after each language tail, preserving gaps and source rows',()=>{
 const before=JSON.stringify(base),plan=planPoolAppends(inputs(),base);assert.deepEqual(plan.map(a=>[a.language,a.start,a.cells.length]),[['Telugu',5,1],['Tamil',3,2]]);
 const s={batches:[batch(plan)]},merged=mergePoolAppends(base,s);assert.equal(merged.Telugu[4][0],'New Telugu');assert.equal(merged.Tamil[3][0],'Another Tamil');assert.deepEqual(merged.Telugu[2],[]);assert.equal(JSON.stringify(base),before);
 const second=planPoolAppends(inputs(),merged);assert.deepEqual(second.map(a=>a.start),[6,5]);
});
test('existing pool phones are held, invalid rows do not consume destination rows',()=>{
 const rows=inputs();rows[0].phone='+919876543210';rows[2].state='Error';inspectPoolDuplicates(rows,base);assert.equal(rows[0].state,'Duplicate');assert.equal(rows[0].reason,'Phone already exists in AP row 2');assert.deepEqual(planPoolAppends(rows,base).map(a=>[a.language,a.start,a.cells.length]),[['Tamil',3,1]]);
});
test('Excel backup and refreshed source preserve append identity and reject conflicting occupied rows',()=>{
 const plan=planPoolAppends(inputs(),base),s={batches:[batch(plan)]};const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet(base.Telugu),'AP');XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet(base.Tamil),'TN');appendWorkbook(w,s);
 const tamil=XLSX.utils.sheet_to_json<unknown[]>(w.Sheets.TN,{header:1});assert.equal(tamil.length,4);assert.equal(tamil[2][0],'New Tamil');assert.equal(tamil[2][2],'TN');
 assert.deepEqual(mergePoolAppends(mergePoolAppends(base,s),s),mergePoolAppends(base,s));
 const conflict=structuredClone(base);conflict.Telugu[4]=['Someone else','','','9876543233'];assert.throws(()=>mergePoolAppends(conflict,s),/AP row 5 conflicts/);
});
test('1000 Telugu and 2000 Tamil leads continue separate existing row ranges',()=>{
 const pools={Telugu:Array.from({length:31001},()=>['Existing','','','9876543210']),Tamil:Array.from({length:18602},()=>['Existing','','TN','','9876543211'])};
 const sample=inputs();const rows=Array.from({length:3000},(_,i)=>({...sample[i<1000?0:1],row:i+2,name:`Imported ${i}`}));
 const plan=planPoolAppends(rows,pools);
 assert.deepEqual(plan.map(a=>[a.language,a.start,a.start+a.cells.length-1]),[['Telugu',31002,32001],['Tamil',18603,20602]]);
 const merged=mergePoolAppends(pools,{batches:[batch(plan)]});assert.equal(merged.Telugu.length,32001);assert.equal(merged.Tamil.length,20602);
});
