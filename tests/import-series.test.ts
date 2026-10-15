import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {nextImportSeries,importPreviewToken} from '../lib/import-series';
import {makeOperation} from '../lib/operations';
import {inspectRows} from '../lib/engine';
import {inspectPoolDuplicates,existingPhoneIndex,planPoolAppends} from '../lib/pool-append';
import {cleanImportWorkbook} from '../lib/clean-import';
import type {Batch,Store,Lead} from '../lib/types';
function state():Pick<Store,'batches'|'operations'>{const r=makeOperation('receipt',{DATE:'2026-10-13','CLIENT ID':'mmsoctm','SERIES NO':'5','FILE NAME':'12012026_.xlsx'},21,'MMS LEAD REPORT');return {batches:[],operations:[r]}}
const pools={Telugu:[['NAME','PAN','PIN','PHONE'],['Already present','','','9876543210']],Tamil:[['NAME','PAN','STATE','PIN','PHONE'],['Tamil existing','','TN','','9876543211']]};
const mapping={name:'Name',phone:'Phone',state:'State'};
const languages=['Telugu','Tamil'];
test('unknown upload names continue mmsoctm while preserving the next numeric series',()=>{const s=state();for(const source of ['12012026_.xlsx','random-customer-list.csv','Different009.xlsx']){const p=nextImportSeries(s,'',[],source);assert.equal(p.file,'mmsoctm06.xlsx');assert.equal(p.series,'6');assert.equal(p.clientId,'mmsoctm');}assert.equal(s.operations![0].file,'12012026_.xlsx')});
test('recognized upload prefix continues that existing series rather than trusting incoming numbers',()=>{const s=state();s.operations!.push(makeOperation('receipt',{DATE:'2026-10-12','CLIENT ID':'VendorABC','SERIES NO':'9','FILE NAME':'ABC-009.xlsx'},2,'MMS LEAD REPORT'));const p=nextImportSeries(s,'',[],'ABC-200.csv');assert.equal(p.file,'ABC-010.xlsx');assert.equal(p.series,'10');assert.equal(p.clientId,'VendorABC')});
test('legacy series without extensions keep their separators and number width',()=>{const s=state();s.operations!.push(makeOperation('receipt',{DATE:'2026-10-12','CLIENT ID':'MMSNH','SERIES NO':'103','FILE NAME':'MMSNH-103'},2,'MMS LEAD REPORT'));const p=nextImportSeries(s,'',[],'mmsnh-001.csv');assert.equal(p.file,'MMSNH-104.xlsx');assert.equal(p.series,'104')});
test('next name accounts for reserved names and preview does not consume a sequence',()=>{const s=state();s.batches.push({file:'mmsoctm06.xlsx'} as Batch);const p=nextImportSeries(s);assert.equal(p.file,'mmsoctm07.xlsx');assert.deepEqual(nextImportSeries(s),p)});
test('first-ever upload asks for a valid filename and rejects path or date-only names',()=>{const s={batches:[],operations:[]};assert.equal(nextImportSeries(s).needsInitialFile,true);assert.equal(nextImportSeries(s).file,'');assert.equal(nextImportSeries(s,'../file01.xlsx').file,'');assert.equal(nextImportSeries(s,'20261015.xlsx').file,'');assert.equal(nextImportSeries(s,'mmsoctm01.xlsx').file,'mmsoctm01.xlsx')});
test('fresh external receipt moves the next mmsoctm number forward',()=>{const s=state(),external=makeOperation('receipt',{DATE:'2026-10-15','CLIENT ID':'mmsoctm','SERIES NO':'7','FILE NAME':'mmsoctm07.xlsx'},22,'MMS LEAD REPORT');assert.equal(nextImportSeries(s,'',[external],'other.xlsx').file,'mmsoctm08.xlsx')});
test('global dedup excludes source phones across languages, changed names and phone formats',()=>{
 const rows=inspectRows([{Name:'Changed name',Phone:'+91 98765 43210',State:'TN'},{Name:'Different language',Phone:'9876543211',State:'AP'},{Name:'New',Phone:'9876543222',State:'TN'},{Name:'Duplicate renamed',Phone:'+919876543222',State:'AP'}],mapping,'',languages,[]);
 const result=inspectPoolDuplicates(rows,pools);assert.deepEqual(result.map(r=>r.state),['Duplicate','Duplicate','Valid','Duplicate']);assert.equal(result[0].reason,'Phone already exists in AP row 2');assert.deepEqual(planPoolAppends(result,pools).map(a=>[a.language,a.start,a.cells.length]),[['Tamil',3,1]]);
});
test('prior imports are checked even when absent from source sheets and names differ',()=>{const lead={id:'previous',phone:'9876543223',name:'Old name',email:''} as Lead;const rows=inspectRows([{Name:'New name',Phone:'+919876543223',State:'AP'}],mapping,'',languages,[lead]);assert.equal(rows[0].state,'Valid');inspectPoolDuplicates(rows,pools,[lead]);assert.equal(rows[0].state,'Duplicate');assert.equal(existingPhoneIndex(pools,[lead]).size,3)});
test('re-uploading the same content under a different name imports no rows',()=>{const rows=inspectRows([{Name:'Renamed',Phone:'9876543210',State:'AP'},{Name:'Renamed again',Phone:'9876543211',State:'TN'}],mapping,'',languages,[]);inspectPoolDuplicates(rows,pools);assert.equal(planPoolAppends(rows,pools).length,0);assert.ok(rows.every(r=>r.state==='Duplicate'))});
test('clean series workbook contains only new valid leads, with source and destination references',()=>{
 const rows=inspectPoolDuplicates(inspectRows([{Name:'Existing',Phone:'9876543210',State:'AP'},{Name:'New Tamil',Phone:'9876543222',State:'TN'}],mapping,'',languages,[]),pools);
 const batch={id:'new',file:'mmsoctm06.xlsx',sourceFile:'random.csv',series:'6',clientId:'mmsoctm',at:'2026-10-15T05:00:00Z',total:2,valid:1,duplicates:1,errors:0,rows,poolAppends:planPoolAppends(rows,pools),checkedExisting:2} as Batch;
 const w=XLSX.read(cleanImportWorkbook(batch),{type:'buffer'});assert.equal(w.Sheets.Telugu,undefined);const tamil=XLSX.utils.sheet_to_json<Record<string,unknown>>(w.Sheets.Tamil);assert.equal(tamil.length,1);assert.equal(tamil[0]['Original filename'],'random.csv');assert.equal(tamil[0]['Destination row'],3);assert.equal(tamil[0]['Normalized phone'],'+919876543222');
 const token=importPreviewToken(rows,batch.poolAppends!,nextImportSeries(state()));assert.notEqual(importPreviewToken(rows,batch.poolAppends!,{...nextImportSeries(state()),file:'mmsoctm07.xlsx'}),token);rows[1].state='Duplicate';assert.notEqual(importPreviewToken(rows,batch.poolAppends!,nextImportSeries(state())),token);
});
