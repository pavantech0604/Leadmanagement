import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {seed} from '../lib/store';
import type {Batch} from '../lib/types';
import type {Pools} from '../lib/transfers';
import {makeOperation} from '../lib/operations';
import {purchaseCost,financeSummary,previewSale,commitSale,recordOpeningCost,costIndex,assertSaleLedgerChanges} from '../lib/lead-finance';
import {parsePrice} from '../lib/money';
const pools:Pools={hash:'source-v1',rows:{Telugu:[['Name','','','Phone'],['Customer A','','','9876500001'],['Customer B','','','9876500002'],['Customer C','','','9876500003']],Tamil:[['Name','','','','Phone'],['Customer D','','','','9876500004']]}};
function fixture(){const s=seed();s.leads=[];s.operations=[];s.batches=[{id:'batch',file:'vendor01.xlsx',at:'2026-10-17',valid:2,total:3,purchase:purchaseCost(100,'uploaded',2,3),rows:[{state:'Valid',phone:'+919876500001'},{state:'Valid',phone:'+919876500002'},{state:'Duplicate',phone:'+919876500001'}]} as Batch];return s;}
const input={buyer:'Buyer Company',lines:[{language:'Telugu',start:2,quantity:1,unitPricePaise:450}]};
test('money is computed in integer paise and bills according to the selected purchase basis',()=>{
 assert.equal(parsePrice('1.50'),150);assert.equal(parsePrice('0'),0);assert.throws(()=>parsePrice('-1'));assert.throws(()=>parsePrice('1.234'));
 assert.equal(purchaseCost(150,'accepted',2498,3000).totalPaise,374700);assert.equal(purchaseCost(150,'uploaded',2498,3000).totalPaise,450000);assert.throws(()=>purchaseCost(-1,'accepted',1,1));
 const costs=costIndex(fixture());assert.equal([...costs.values()].reduce((sum,cost)=>sum+cost,0),300);
});
test('internal floor use creates no revenue; resale does not charge acquisition cost twice',()=>{
 const s=fixture();s.operations=[makeOperation('dispatch',{DATE:'2026-10-17',NAME:'CG Floor',LANG:'Telugu',RANGE:'2-2','FILE NAME':'cg01.xlsx'},2,'UPDATE')];
 assert.equal(financeSummary(s).revenuePaise,0);const first=previewSale(s,input,pools);assert.equal(first.requiresAcknowledgement,true);assert.throws(()=>commitSale(s,input,pools,first.token,'first','Owner'),/acknowledge/);
 commitSale(s,{...input,reuseAcknowledged:true},pools,first.token,'first','Owner');
 const resale={...input,reuseAcknowledged:true,lines:[{...input.lines[0],unitPricePaise:200}]};const second=previewSale(s,resale,pools);assert.equal(second.costPaise,0);commitSale(s,resale,pools,second.token,'second','Owner');
 const summary=financeSummary(s);assert.equal(summary.purchaseSpendPaise,300);assert.equal(summary.revenuePaise,650);assert.equal(summary.costOfSalesPaise,150);assert.equal(summary.profitPaise,500);assert.equal(summary.netResultPaise,350);assert.equal(s.operations.length,1);assert.equal(s.batches.length,1);
});
test('unknown costs remain pending and can be backfilled without inventing a zero cost',()=>{
 const s=fixture();const saleInput={...input,lines:[{language:'Telugu',start:4,quantity:1,unitPricePaise:200}]};const preview=previewSale(s,saleInput,pools);assert.equal(preview.profitPaise,null);commitSale(s,saleInput,pools,preview.token,'unknown','Owner');assert.equal(financeSummary(s).profitPaise,null);
 recordOpeningCost(s,{label:'Earlier stock',language:'Telugu',start:4,quantity:1,unitPricePaise:50},pools);assert.equal(financeSummary(s).profitPaise,150);assert.equal(financeSummary(s).purchaseSpendPaise,350);assert.throws(()=>recordOpeningCost(s,{label:'Duplicate cost',language:'Telugu',start:4,quantity:1,unitPricePaise:50},pools),/already/);
});
test('sale confirmation is idempotent, source-sensitive and exports exact language rows',()=>{
 const s=fixture(),request={buyer:'Buyer',lines:[{language:'Telugu',start:2,quantity:1,unitPricePaise:300},{language:'Tamil',start:2,quantity:1,unitPricePaise:400}]};const plan=previewSale(s,request,pools);const sale=commitSale(s,request,pools,plan.token,'one-key','Owner');assert.equal(commitSale(s,request,pools,plan.token,'one-key','Owner').id,sale.id);assert.equal(s.sales?.length,1);
 assert.throws(()=>commitSale(s,{...request,buyer:'Different'},pools,plan.token,'one-key','Owner'),/different sale/);
 const book=XLSX.read(Buffer.from(sale.artifact,'base64'),{type:'buffer'});assert.ok(book.Sheets.Telugu);assert.ok(book.Sheets.Tamil);assert.equal(XLSX.utils.sheet_to_json(book.Sheets.Telugu).length,1);
 const fresh={...input,lines:[{...input.lines[0],start:3}]},next=previewSale(s,fresh,pools);assert.throws(()=>commitSale(s,fresh,{...pools,hash:'changed'},next.token,'new-key','Owner'),/changed/);
});
test('invalid ranges and duplicate phones are rejected; cancellation removes revenue but keeps costs',()=>{
 const s=fixture();assert.throws(()=>previewSale(s,{...input,lines:[{...input.lines[0],start:1}]},pools),/invalid phone|heading/);assert.throws(()=>previewSale(s,{...input,lines:[{...input.lines[0],quantity:10001}]},pools),/10,000/);
 const duplicate={...pools,rows:{...pools.rows,Telugu:[...pools.rows.Telugu,['Repeated','','','9876500001']]}};assert.throws(()=>previewSale(s,{...input,lines:[{...input.lines[0],start:2,quantity:4}]},duplicate),/duplicate phone/);
 const plan=previewSale(s,input,pools);const sale=commitSale(s,input,pools,plan.token,'key','Owner');sale.status='cancelled';assert.equal(financeSummary(s).revenuePaise,0);assert.equal(financeSummary(s).purchaseSpendPaise,300);assert.equal(financeSummary(s).netResultPaise,-300);assert.throws(()=>commitSale(s,input,pools,plan.token,'key','Owner'),/cancelled/);
});

test('apportionment preserves every paid paise and a cost edit invalidates an older sale preview',()=>{
 const s=fixture();s.batches[0].purchase=purchaseCost(1,'uploaded',2,3);assert.equal([...costIndex(s).values()].reduce((sum,cost)=>sum+cost,0),3);
 const plan=previewSale(s,input,pools);s.batches[0].purchase=purchaseCost(200,'accepted',2,3);assert.throws(()=>commitSale(s,input,pools,plan.token,'edited-cost','Owner'),/changed/);assert.equal(s.sales?.length||0,0);
});

test('recorded sales cannot be deleted or silently repriced; cancellations preserve their audit trail',()=>{
 const original=fixture(),preview=previewSale(original,input,pools);commitSale(original,input,pools,preview.token,'immutable','Owner');
 const removed=structuredClone(original);removed.sales=[];assert.throws(()=>assertSaleLedgerChanges(original,removed),/cannot be removed/);
 const repriced=structuredClone(original);repriced.sales![0].totalPaise=1;assert.throws(()=>assertSaleLedgerChanges(original,repriced),/immutable/);
 const cancelled=structuredClone(original);cancelled.sales![0].status='cancelled';cancelled.sales![0].cancelledAt=new Date().toISOString();assert.doesNotThrow(()=>assertSaleLedgerChanges(original,cancelled));
 assert.throws(()=>assertSaleLedgerChanges(cancelled,original),/reactivated/);
});
