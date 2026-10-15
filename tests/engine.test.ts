import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizePhone,inspectRows,canSee,detectImportColumns} from '../lib/engine';
import {seed} from '../lib/store';
const mapping={name:'Name',phone:'Phone',language:'Language',email:'Email'};
const languages=['English','Hindi','Tamil','Telugu','Malayalam','Kannada','Unassigned'];
test('branch-free uploads are visible to the two workspace operators but not other roles',()=>{const s=seed(),lead={...s.leads[0],branchId:''};assert.equal(canSee(s.users[0],lead,s.users),true);assert.equal(canSee(s.users[1],lead,s.users),true);for(const u of s.users.slice(2))assert.equal(canSee(u,lead,s.users),false)});
test('phone formatting normalizes to the same E.164 key',()=>{assert.equal(normalizePhone('98765 43210'),'+919876543210');assert.equal(normalizePhone('+91 (98765)-43210'),'+919876543210');assert.equal(normalizePhone('123'),'')});
test('names cleaned and languages normalized; raw records preserved',()=>{const raw={Name:'  Ravi   Kumar!! ',Phone:'9876543210',Language:'HI'};const [r]=inspectRows([raw],mapping,'',languages,[]);assert.equal(r.name,'Ravi Kumar');assert.equal(r.language,'Hindi');assert.deepEqual(r.raw,raw);assert.equal(r.state,'Valid')});
test('missing fields and unknown languages stay in review, never valid',()=>{const rows=inspectRows([{Name:'',Phone:'9876543210'},{Name:'A',Phone:'12'},{Name:'A',Phone:'9876543210',Language:'Unknown'}],mapping,'English',languages,[]);assert.ok(rows.every(r=>r.state==='Error'))});
test('missing language uses configured fallback or Unassigned',()=>{assert.equal(inspectRows([{Name:'A',Phone:'9876543210'}],mapping,'',languages,[])[0].language,'Unassigned')});
test('duplicate within file retains one valid lead',()=>{const rows=inspectRows([{Name:'A',Phone:'9876543210'},{Name:'A',Phone:'+91 9876543210'}],mapping,'English',languages,[]);assert.deepEqual(rows.map(r=>r.state),['Valid','Duplicate'])});
test('existing phone match links lead; different name requires review',()=>{const s=seed();const l=s.leads[0];const rows=inspectRows([{Name:l.name,Phone:l.phone},{Name:'Different Name',Phone:l.phone}],mapping,'English',languages,s.leads);assert.equal(rows[0].state,'Duplicate');assert.equal(rows[0].existingId,l.id);assert.equal(rows[1].state,'Potential duplicate')});
test('email match is potential; name alone is not duplicate',()=>{const s=seed();const l=s.leads[0];assert.equal(inspectRows([{Name:'Different',Phone:'9876543210',Email:l.email}],mapping,'English',languages,s.leads)[0].state,'Potential duplicate');assert.equal(inspectRows([{Name:l.name,Phone:'9876543210'}],mapping,'English',languages,s.leads)[0].state,'Valid')});
test('admin sees all; manager and employee branch boundaries enforced',()=>{const s=seed();assert.ok(s.leads.every(l=>canSee(s.users[0],l,s.users)));const manager=s.users[1];assert.ok(s.leads.filter(l=>canSee(manager,l,s.users)).every(l=>manager.branchIds.includes(l.branchId)));const employee=s.users[6];assert.ok(s.leads.filter(l=>canSee(employee,l,s.users)).every(l=>l.assignedTo===employee.id&&employee.branchIds.includes(l.branchId)))});
test('team leader sees only their team in their branch',()=>{const s=seed();const tl=s.users[4];assert.ok(s.leads.filter(l=>canSee(tl,l,s.users)).every(l=>s.users.find(u=>u.id===l.assignedTo)?.team===tl.team&&tl.branchIds.includes(l.branchId)))});
test('seed satisfies requested sample counts',()=>{const s=seed();assert.equal(s.leads.length,500);assert.equal(s.users.length,10);assert.equal(s.branches.length,3);assert.equal(s.vendors.length,3);assert.ok(s.languages.length>=5);assert.equal(new Set(s.leads.map(l=>l.phone)).size,500)});

test('mixed state rows route independently and preserve original values',()=>{
 const rows=[' Tamil Nadu ','Andhra Pradesh','Telangana','T.N.','AP','IN-TG'].map((State,i)=>({Name:'Customer',Phone:String(9876543210+i),State}));
 const result=inspectRows(rows,{name:'Name',phone:'Phone',state:'State'},'English',languages,[]);
 assert.deepEqual(result.map(r=>r.language),['Tamil','Telugu','Telugu','Tamil','Telugu','Telugu']);
 assert.ok(result.every(r=>r.state==='Valid'&&r.languageSource?.startsWith('State:')));
 assert.deepEqual(result[0].raw,rows[0]);
});
test('state names mapped into language work; mapped state determines routing',()=>{
 assert.equal(inspectRows([{Name:'A',Phone:'9876543210',Language:'Tamil Nadu'}],mapping,'',languages,[])[0].language,'Tamil');
 const r=inspectRows([{Name:'A',Phone:'9876543210',Language:'Telugu',State:'Tamil Nadu'}],{...mapping,state:'State'},'',languages,[])[0];
 assert.equal(r.language,'Tamil');assert.equal(r.languageSource,'State: Tamil Nadu');
});
test('unknown state is never silently assigned a fallback; blanks may use fallback',()=>{
 const m={...mapping,state:'State'};
 assert.equal(inspectRows([{Name:'A',Phone:'9876543210',State:'Unknown'}],m,'Tamil',languages,[])[0].state,'Error');
 assert.equal(inspectRows([{Name:'A',Phone:'9876543210',State:''}],m,'Tamil',languages,[])[0].language,'Tamil');
 assert.equal(inspectRows([{Name:'A',Phone:'9876543210',Language:'Typo',State:'TN'}],m,'Tamil',languages,[])[0].language,'Tamil');
});
test('column detection distinguishes customer and state names',()=>{
 const m=detectImportColumns(['State Name','Customer Name','Mobile Number','Language']);
 assert.equal(m.name,'Customer Name');assert.equal(m.state,'State Name');assert.equal(m.phone,'Mobile Number');assert.equal(m.language,'Language');
});

import * as XLSX from 'xlsx';
import {parseLeadFile} from '../lib/import-file';
test('all workbook sheets: 1000 Telugu and 2000 Tamil with different headers',()=>{
 const w=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(w,XLSX.utils.json_to_sheet(Array.from({length:1000},(_,i)=>({Name:'Customer '+i,Phone:String(9876500000+i),State:'Andhra Pradesh'}))),'Telugu');
 XLSX.utils.book_append_sheet(w,XLSX.utils.json_to_sheet(Array.from({length:2000},(_,i)=>({'Customer Name':'Customer '+i,'Mobile Number':String(9876600000+i),'State Name':'Tamil Nadu'}))),'Tamil');
 XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([]),'Empty');
 const parsed=parseLeadFile(XLSX.write(w,{type:'array',bookType:'xlsx'}),'leads.xlsx');
 const checked=inspectRows(parsed.rows,parsed.mapping,'',languages,[]);
 assert.equal(checked.length,3000);assert.equal(checked.filter(r=>r.language==='Telugu').length,1000);assert.equal(checked.filter(r=>r.language==='Tamil').length,2000);
 assert.ok(checked.every(r=>r.state==='Valid'));assert.deepEqual(parsed.sources.map(s=>s.count),[1000,2000,0]);
});
test('CSV reads every language group and duplicates across worksheets remain held',()=>{
 const csv=new TextEncoder().encode('Name,Phone,State\nA,9876543210,AP\nB,9876543211,TN');
 const parsed=parseLeadFile(csv.buffer,'mixed.csv');assert.deepEqual(inspectRows(parsed.rows,parsed.mapping,'',languages,[]).map(r=>r.language),['Telugu','Tamil']);
 const w=XLSX.utils.book_new();for(const state of ['AP','TN'])XLSX.utils.book_append_sheet(w,XLSX.utils.json_to_sheet([{Name:'A',Phone:'9876543210',State:state}]),state);
 const workbook=parseLeadFile(XLSX.write(w,{type:'array',bookType:'xlsx'}),'duplicates.xlsx');assert.deepEqual(inspectRows(workbook.rows,workbook.mapping,'',languages,[]).map(r=>r.state),['Valid','Duplicate']);
});

test('imports title rows and alternate headers without losing language groups',()=>{
 const workbook=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Daily delivery'],[],['Client Name','Mobile No','State'],['Customer A','9876543210','TN'],['Customer B','9876543211','AP']]),'Delivery');
 const result=parseLeadFile(XLSX.write(workbook,{type:'array',bookType:'xlsx'}),'vendor.xlsx');
 assert.equal(result.rows.length,2);assert.equal(result.warnings.length,1);
 assert.deepEqual(inspectRows(result.rows,result.mapping,'',languages,[]).map(row=>row.language),['Tamil','Telugu']);
});
test('reads semicolon and UTF16 exports and preserves uneven CSV rows for review',()=>{
 const csv=new TextEncoder().encode('Vendor delivery\nName;Phone;State\nA;9876543210;TN\nB;9876543211;AP;extra');
 const result=parseLeadFile(csv.buffer,'vendor.csv');assert.equal(result.rows.length,2);
 assert.equal(result.rows[1]['Column 4'],'extra');assert.ok(result.mapping.phone);
 const utf16=Buffer.from('\ufeffName,Phone,State\nA,9876543210,TN','utf16le');
 assert.equal(parseLeadFile(utf16.buffer.slice(utf16.byteOffset,utf16.byteOffset+utf16.byteLength) as ArrayBuffer,'other.csv').rows.length,1);
});
test('unknown headings remain available for manual mapping and empty files explain the issue',()=>{
 const bytes=new TextEncoder().encode('Person,Number,Region\nA,9876543210,TN');
 const result=parseLeadFile(bytes.buffer,'other.csv');assert.equal(result.rows.length,1);assert.ok(result.columns.includes('Number'));assert.ok(result.warnings.length);
 assert.throws(()=>parseLeadFile(new ArrayBuffer(0),'empty.csv'),/No lead rows/);
});
