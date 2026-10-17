import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeOperation} from '../lib/operations';
import {seed} from '../lib/store';
import {reconcileGoogleRegisters} from '../lib/register-reconciliation';
const receipt=(file:string,row:number)=>makeOperation('receipt',{DATE:'2026-10-01','FILE NAME':file,'CLIENT ID':'mms','SERIES NO':file,TAMIL:'2-10'},row,'MMS LEAD REPORT');
const dispatch=(file:string,row:number,range='2-10')=>makeOperation('dispatch',{DATE:'2026-10-01',NAME:'CG Floor',LANG:'Tamil',RANGE:range,'FILE NAME':file},row,'UPDATE');
test('Google deletion removes only absent records and shifted rows retain identity',()=>{
 const s=seed(),a=receipt('mms01',2),b=receipt('mms02',3),c=receipt('mms03',4),d=dispatch('floor01.xlsx',2);
 s.operations=[a,b,c,d];const result=reconcileGoogleRegisters(s,[receipt('mms01',2),receipt('mms03',3),d]);
 assert.equal(result.removed,1);assert.equal(result.moved,1);assert.equal(result.added,0);assert.ok(!s.operations.some(record=>record.id===b.id));assert.equal(s.operations.find(record=>record.file==='mms03')?.id,c.id);assert.equal(s.operations.find(record=>record.file==='mms03')?.sourceRow,3);assert.equal(s.audit[0].action,'Google registers reconciled');
});
test('source edits update in place while manual and import history remain intact',()=>{
 const s=seed(),a=receipt('mms01',2),d=dispatch('floor01.xlsx',2),manual={...receipt('private-entry',0),sourceSheet:'Manual entry'};
 s.operations=[a,d,manual];const result=reconcileGoogleRegisters(s,[a,dispatch('floor01.xlsx',2,'11-20')]);
 assert.equal(result.updated,1);assert.equal(result.removed,0);assert.equal(s.operations.find(record=>record.file===d.file)?.id,d.id);assert.ok(s.operations.includes(manual));
});
test('duplicate rows are counted independently and incomplete snapshots cannot delete records',()=>{
 const s=seed(),a=receipt('mms01',2),b={...receipt('mms01',3),id:'second'},d=dispatch('floor01.xlsx',2);s.operations=[a,b,d];
 assert.equal(reconcileGoogleRegisters(s,[a,d]).removed,1);const before=JSON.stringify(s);assert.throws(()=>reconcileGoogleRegisters(s,[a]),/Both Google registers/);assert.equal(JSON.stringify(s),before);
});

test('a date correction on a unique file updates the same record instead of deleting it',()=>{
 const s=seed(),a=receipt('mms01',2),d=dispatch('floor01.xlsx',2);s.operations=[a,d];
 const changed={...dispatch('floor01.xlsx',2),date:'2026-10-02',raw:{...d.raw,DATE:'2026-10-02'}};
 const result=reconcileGoogleRegisters(s,[a,changed]);assert.equal(result.updated,1);assert.equal(result.removed,0);assert.equal(result.added,0);assert.equal(s.operations.find(record=>record.file===d.file)?.id,d.id);
});
