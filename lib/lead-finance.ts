import {createHash,randomUUID} from 'node:crypto';
import * as XLSX from 'xlsx';
import {normalizePhone} from './engine';
import {poolMap} from './pool-append';
import type {Pools} from './transfers';
import type {Store,PurchaseCost,Sale,SaleLine} from './types';
export function purchaseCost(unitPricePaise:number,basis:PurchaseCost['basis'],accepted:number,uploaded:number):PurchaseCost{
 if(!Number.isSafeInteger(unitPricePaise)||unitPricePaise<0||unitPricePaise>99999999)throw Error('Invalid purchase price.');
 const billableQuantity=basis==='uploaded'?uploaded:accepted;const totalPaise=unitPricePaise*billableQuantity;
 if(!Number.isSafeInteger(totalPaise))throw Error('Purchase total is too large.');return {unitPricePaise,basis,billableQuantity,totalPaise};
}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function costIndex(s:Store){
 const index=new Map<string,number>();
 for(const b of s.batches.slice().sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id))){if(!b.purchase)continue;const keys=[...new Set(b.rows.filter(row=>row.state==='Valid').map(row=>row.phone).filter(Boolean))];
  if(!keys.length)continue;const base=Math.floor(b.purchase.totalPaise/keys.length),remainder=b.purchase.totalPaise%keys.length;
  keys.forEach((key,i)=>{if(!index.has(key))index.set(key,base+(i<remainder?1:0));});
 }
 for(const purchase of s.openingPurchases||[])for(const key of purchase.keys)if(!index.has(key))index.set(key,purchase.unitPricePaise);
 return index;
}
export function financeSummary(s:Store){
 const costs=costIndex(s),seen=new Set<string>();let revenuePaise=0,costOfSalesPaise=0,unknownSold=0,quantity=0;
 const completed=(s.sales||[]).filter(sale=>sale.status==='completed').slice().sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
 for(const sale of completed){revenuePaise+=sale.totalPaise;for(const line of sale.lines){quantity+=line.quantity;for(const key of line.keys)if(!seen.has(key)){seen.add(key);const cost=costs.get(key);if(cost===undefined)unknownSold++;else costOfSalesPaise+=cost;}}}
 const purchaseSpendPaise=s.batches.reduce((total,batch)=>total+(batch.purchase?.totalPaise||0),0)+(s.openingPurchases||[]).reduce((total,purchase)=>total+purchase.totalPaise,0);
 return {purchaseSpendPaise,revenuePaise,costOfSalesPaise,profitPaise:unknownSold?null:revenuePaise-costOfSalesPaise,netCashPaise:revenuePaise-purchaseSpendPaise,netResultPaise:unknownSold||s.batches.some(batch=>!batch.purchase)?null:revenuePaise-purchaseSpendPaise,unknownSold,quantity,salesCount:completed.length,unpricedBatches:s.batches.filter(batch=>!batch.purchase).length};
}
export type FinanceSummary=ReturnType<typeof financeSummary>;
export type SaleInput={buyer:string;lines:{language:string;start:number;quantity:number;unitPricePaise:number}[];reuseAcknowledged?:boolean};
function selectedRows(pools:Pools,line:SaleInput['lines'][number]){
 const pool=poolMap[line.language];if(!pool)throw Error('Select a supported language.');const rows=pools.rows[line.language];if(!rows)throw Error('Language source is missing. Refresh the source sheet.');
 const selected=[];for(let row=line.start;row<line.start+line.quantity;row++){const cells=rows[row-1],name=String(cells?.[pool.name]??'').trim(),phone=normalizePhone(String(cells?.[pool.phone]??''));if(!name||!phone)throw Error(`${line.language} row ${row} is blank, a heading, or has an invalid phone. No rows will be skipped.`);selected.push({key:phone,name,phone,row});}
 return selected;
}
export function previewSale(s:Store,input:SaleInput,pools:Pools){
 if(!input.buyer.trim()||input.buyer.length>120)throw Error('Enter the buyer name.');
 if(!input.lines.length||input.lines.length>5||new Set(input.lines.map(line=>line.language)).size!==input.lines.length)throw Error('Select each language once.');
 if(input.lines.reduce((total,line)=>total+line.quantity,0)>10000)throw Error('Use at most 10,000 leads per sale.');
 const selected=new Map<string,{language:string;row:number}>(),costs=costIndex(s);let unknown=0,allocatedCost=0;const previouslySold=new Set((s.sales||[]).filter(sale=>sale.status==='completed').flatMap(sale=>sale.lines.flatMap(line=>line.keys)));
 const history:{language:string;type:string;reference:string;quantity:number}[]=[];
 const lines:SaleLine[]=input.lines.map(line=>{
  if(!Number.isSafeInteger(line.start)||line.start<1||!Number.isSafeInteger(line.quantity)||line.quantity<1||line.quantity>10000||!Number.isSafeInteger(line.unitPricePaise)||line.unitPricePaise<0||line.unitPricePaise>99999999)throw Error('Check the range, quantity and price.');
  const rows=selectedRows(pools,line);for(const row of rows){if(selected.has(row.key)){const previous=selected.get(row.key)!;throw Error(`This request contains a duplicate phone: ${line.language} row ${row.row} repeats ${previous.language} row ${previous.row}. Adjust the range; no rows were skipped.`);}selected.set(row.key,{language:line.language,row:row.row});if(!previouslySold.has(row.key)){const cost=costs.get(row.key);if(cost===undefined)unknown++;else allocatedCost+=cost;}}
  const keys=rows.map(row=>row.key),keySet=new Set(keys);
  for(const sale of (s.sales||[]).filter(sale=>sale.status==='completed')){const count=sale.lines.flatMap(other=>other.keys).filter(key=>keySet.has(key)).length;if(count)history.push({language:line.language,type:'Previous sale',reference:`${sale.file} · ${sale.buyer}`,quantity:count});}
  for(const operation of (s.operations||[]).filter(record=>record.kind==='dispatch'))for(const segment of operation.segments)if(segment.language===line.language&&segment.start!==null&&segment.end!==null){const overlap=Math.min(line.start+line.quantity-1,segment.end)-Math.max(line.start,segment.start)+1;if(overlap>0)history.push({language:line.language,type:'Floor delivery',reference:`${operation.floor} · ${operation.file}`,quantity:overlap});}
  return {...line,end:line.start+line.quantity-1,totalPaise:line.quantity*line.unitPricePaise,keys};
 });
 const totalPaise=lines.reduce((total,line)=>total+line.totalPaise,0);if(!Number.isSafeInteger(totalPaise))throw Error('Sale total is too large.');
 let sequence=(s.sales||[]).length+1;let file='';do{file=`CG-SALE-${String(sequence++).padStart(4,'0')}.xlsx`}while((s.sales||[]).some(sale=>sale.file===file)||(s.operations||[]).some(operation=>operation.file===file)||s.batches.some(batch=>batch.file===file));
 const token=digest({input:{...input,reuseAcknowledged:undefined},source:pools.hash,lines,costs:[...costs],sales:(s.sales||[]).map(sale=>[sale.id,sale.status]),history,file});
 return {file,lines,totalPaise,costPaise:allocatedCost,profitPaise:unknown?null:totalPaise-allocatedCost,unknownCost:unknown,history,requiresAcknowledgement:history.length>0,token};
}
export function publicSale(sale:Sale){return {id:sale.id,file:sale.file,buyer:sale.buyer,at:sale.at,by:sale.by,totalPaise:sale.totalPaise,status:sale.status,cancelledAt:sale.cancelledAt,lines:sale.lines.map(line=>({...line,keys:undefined}))};}
export function commitSale(s:Store,input:SaleInput,pools:Pools,token:string,key:string,by:string){
 const requestHash=digest(input),old=s.sales?.find(sale=>sale.key===key);if(old){if(old.requestHash!==requestHash)throw Error('This confirmation key belongs to a different sale.');if(old.status==='cancelled')throw Error('This sale was cancelled. Prepare a new request.');return old;}
 const plan=previewSale(s,input,pools);if(token!==plan.token)throw Error('The lead data, costs or sales history changed. Review the request again.');if(plan.requiresAcknowledgement&&!input.reuseAcknowledged)throw Error('Review and acknowledge the earlier deliveries before confirming.');
 const book=XLSX.utils.book_new();for(const line of input.lines){const rows=selectedRows(pools,line);XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(rows.map(row=>({Name:row.name,Phone:row.phone,'Source row':row.row,Language:line.language}))),line.language);}
 XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet([{Buyer:input.buyer,File:plan.file,'Sale value INR':plan.totalPaise/100,'Created at':new Date().toISOString()}]),'Sale receipt');
 const sale:Sale={id:randomUUID(),key,requestHash,file:plan.file,buyer:input.buyer.trim(),at:new Date().toISOString(),by,lines:plan.lines,totalPaise:plan.totalPaise,status:'completed',artifact:Buffer.from(XLSX.write(book,{type:'buffer',bookType:'xlsx',compression:true})).toString('base64')};s.sales??=[];s.sales.push(sale);s.audit.unshift({id:randomUUID(),at:sale.at,by,role:'Admin',action:'Lead sale recorded',old:null,next:{id:sale.id,buyer:sale.buyer,totalPaise:sale.totalPaise,file:sale.file}});return sale;
}
export function recordOpeningCost(s:Store,input:{label:string;language:string;start:number;quantity:number;unitPricePaise:number},pools:Pools){
 const rows=selectedRows(pools,input),keys=rows.map(row=>row.key),known=costIndex(s);const imported=new Set(s.batches.flatMap(batch=>batch.rows.filter(row=>row.state==='Valid').map(row=>row.phone)));
 if(new Set(keys).size!==keys.length)throw Error('The range contains duplicate phones. Record smaller, unique ranges.');if(keys.some(key=>known.has(key)||imported.has(key)))throw Error('Some rows already have a purchase record or belong to an upload. Update that upload’s price instead.');
 const record={id:randomUUID(),label:input.label,language:input.language,start:input.start,end:input.start+input.quantity-1,unitPricePaise:input.unitPricePaise,totalPaise:input.unitPricePaise*input.quantity,keys,at:new Date().toISOString()};s.openingPurchases??=[];s.openingPurchases.push(record);return record;
}

export function assertSaleLedgerChanges(before:Store,after:Store){
 const ids=new Set<string>(),keys=new Set<string>(),files=new Set<string>();
 for(const sale of after.sales||[]){if(ids.has(sale.id)||keys.has(sale.key)||files.has(sale.file.toLowerCase()))throw Error('Sales must have unique records, confirmation keys and filenames.');ids.add(sale.id);keys.add(sale.key);files.add(sale.file.toLowerCase());}
 for(const sale of before.sales||[]){const changed=after.sales?.find(record=>record.id===sale.id);if(!changed)throw Error('Completed sales cannot be removed. Cancel the sale to preserve its audit history.');
  if(JSON.stringify({...sale,status:undefined,cancelledAt:undefined})!==JSON.stringify({...changed,status:undefined,cancelledAt:undefined}))throw Error('Recorded sale prices, buyer, ranges and files are immutable. Cancel and create a corrected sale.');
  if(sale.status==='cancelled'&&changed.status!=='cancelled')throw Error('A cancelled sale cannot be reactivated.');
  if(changed.status!==sale.status&&!(sale.status==='completed'&&changed.status==='cancelled'&&changed.cancelledAt))throw Error('Invalid sale status change.');
 }
}
