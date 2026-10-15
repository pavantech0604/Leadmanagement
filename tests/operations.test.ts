import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {makeOperation,rangeSegment,overlaps,previousFileName} from '../lib/operations';
import {resolveRows,readOperationsWorkbook} from '../lib/sheet-source';
test('physical row range endpoints retained; multilingual request is one dispatch',()=>{const r=makeOperation('dispatch',{DATE:'2026-09-01',NAME:'Fin Flooor',LANG:'TELUGU+KANNADA',RANGE:'6501-6800 + 2000-2300','FILE NAME':'floor.xlsx'},3,'UPDATE');assert.equal(r.floor,'Fin Floor');assert.equal(r.segments.length,2);assert.equal(r.segments[0].start,6501);assert.equal(r.segments[1].end,2300);assert.equal(r.actualCount,null)});
test('count physical populated rows, exclude header and blank; do not infer from span',()=>{const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['NAME','PAN','PIN','MOBILE NUMBER'],['Customer A','','','9876543210'],['','','',''],['Customer B','','','9876543211']]),'AP');const r=resolveRows(makeOperation('dispatch',{DATE:'2026-09-01',NAME:'CG FLOOR',LANG:'Telugu',RANGE:'1-4'},2,'UPDATE'),w);assert.equal(r.actualCount,2);assert.equal(r.segments[0].headerCount,1);assert.equal(r.segments[0].missingCount,1);assert.ok(r.issues.length)});
test('negative and reversed ranges require review, raw original remains intact',()=>{assert.equal(rangeSegment('Telugu','-27202').count,null);assert.equal(rangeSegment('Telugu','20-10').count,null);const raw={DATE:'2026-09-08',NAME:'Fin Floor',LANG:'telugu',RANGE:'-27202'};const r=makeOperation('dispatch',raw,35,'UPDATE');assert.equal(r.count,null);assert.deepEqual(r.raw,raw)});
test('shared range detection compares same language and direction only',()=>{const a=makeOperation('dispatch',{DATE:'2026-09-01',NAME:'CG Floor',LANG:'Telugu',RANGE:'10-20'},2,'UPDATE');const b=makeOperation('dispatch',{DATE:'2026-09-02',NAME:'Fin Floor',LANG:'Telugu',RANGE:'15-25'},3,'UPDATE');assert.equal(overlaps([a,b])[0].start,15);assert.equal(overlaps([a,{...b,kind:'receipt'}]).length,0)});
test('workbook import keeps registers separate, calendar dates stable and malformed history visible',()=>{
 const w=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['NAME','PAN','PIN','PHONE'],['Private A','','','9876543210'],['Private B','','','9876543211']]),'AP');
 XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['NAME','PAN','STATE','PIN','PHONE'],['Private C','','TN','','9876543212'],['Private D','','TN','','9876543213']]),'TN');
 XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['DATE','NAME','LANG','RANGE','FILE NAME'],[46295,'CG Floor','Telugu+Tamil','2-3 + 2-3','cg-test.xlsx'],[46294,'Fin Floor','Telugu','-27202','bad-test.xlsx']]),'UPDATE');
 XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['DATE','CLIENT NAME','CLIENT ID','SERIES NO','TELUGU','KANNADA','TAMIL','MALYALAM','HINDI','TOTAL LEAD','FILE NAME'],[46303,'','mmsoctm',4,'2-3','','2-3','','',4,'receipt-test.xlsx']]),'MMS LEAD REPORT');
 const rows=readOperationsWorkbook(Buffer.from(XLSX.write(w,{type:'buffer',bookType:'xlsx'})));
 assert.equal(rows.filter(r=>r.kind==='receipt').length,1);assert.equal(rows.filter(r=>r.kind==='dispatch').length,2);
 assert.ok(rows.every(r=>['UPDATE','MMS LEAD REPORT'].includes(r.sourceSheet)));assert.equal(rows.find(r=>r.file==='bad-test.xlsx')?.actualCount,null);
 assert.equal(rows.find(r=>r.file==='receipt-test.xlsx')?.date,'2026-10-08');assert.equal(rows.find(r=>r.file==='cg-test.xlsx')?.date,'2026-09-30');
 assert.ok(rows.filter(r=>r.actualCount!=null).every(r=>r.actualCount===r.segments.reduce((n,s)=>n+(s.matchedCount||0),0)));assert.equal(JSON.stringify(rows).includes('Private A'),false);
});

test('file names reuse newest nonempty reference for the same floor and record kind',()=>{const a=makeOperation('dispatch',{DATE:'2026-09-01',NAME:'CG Floor','FILE NAME':'cg-01.xlsx'},2,'UPDATE');const b={...a,date:'2026-09-03',file:'cg-03.xlsx'};const other={...b,floor:'Fin Floor',file:'fin.xlsx',date:'2026-09-04'};assert.equal(previousFileName([a,b,other],'dispatch','cg floor'),'cg-03.xlsx');assert.equal(previousFileName([a,b,other],'dispatch','New Floor'),'');assert.equal(previousFileName([a,b,other],'receipt'),'');assert.equal(previousFileName([a,{...b,file:' '}],'dispatch','CG Floor'),'cg-01.xlsx')});
