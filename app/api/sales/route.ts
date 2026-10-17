import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {readStore,mutate} from '@/lib/store';
import {session} from '@/lib/auth';
import {canTransfer,loadPools} from '@/lib/transfers';
import {parsePrice} from '@/lib/money';
import {previewSale,commitSale,publicSale,purchaseCost,recordOpeningCost} from '@/lib/lead-finance';
export const runtime='nodejs';export const maxDuration=120;
const row=z.object({language:z.enum(['Telugu','Tamil','Kannada','Malayalam','Hindi']),start:z.number().int().min(1).max(1000000),quantity:z.number().int().min(1).max(10000),price:z.string().max(20)});
export async function GET(){try{const s=await readStore(),user=await session(s);if(!user||!canTransfer(user))return NextResponse.json({error:'Access denied'},{status:403});const pools=await loadPools(s);const phoneColumns:Record<string,number>={Telugu:3,Tamil:4,Kannada:4,Malayalam:3,Hindi:6};const sources=Object.entries(pools.rows).map(([language,rows])=>{const first=rows.findIndex(row=>String(row[0]??'').trim()&&String(row[phoneColumns[language]]??'').replace(/\D/g,'').length>=10);return {language,firstRow:first<0?null:first+1,lastRow:rows.length}});return NextResponse.json({sources},{headers:{'Cache-Control':'private, no-store'}});}catch{return NextResponse.json({error:'Could not load language source ranges. Retry or refresh the Google Sheet.'},{status:503})}}
export async function POST(req:NextRequest){try{
 const origin=req.headers.get('origin');if(!origin||new URL(origin).host!==req.headers.get('host'))return NextResponse.json({error:'Invalid origin'},{status:403});
 const body=await req.json();const action=z.enum(['preview','commit','batch-cost','opening-cost','opening-price','cancel']).parse(body.action);
 const s=await readStore(),user=await session(s);if(!user)return NextResponse.json({error:'Sign in required'},{status:401});if(!canTransfer(user))return NextResponse.json({error:'Permission denied'},{status:403});
 if(action==='preview'||action==='commit'){
  const parsed=z.object({buyer:z.string().trim().min(1).max(120),lines:z.array(row).min(1).max(5),reuseAcknowledged:z.boolean().optional()}).parse(body.input);
  const input={...parsed,lines:parsed.lines.map(line=>({...line,unitPricePaise:parsePrice(line.price)}))};
  if(action==='preview'){const preview=previewSale(s,input,await loadPools(s));return NextResponse.json({preview:{...preview,lines:preview.lines.map(line=>({...line,keys:undefined}))}});}
  const key=z.string().uuid().parse(body.key),token=z.string().length(64).parse(body.token);
  const result=await mutate(async current=>{const actor=await session(current);if(!actor||!canTransfer(actor))throw Error('Permission denied');return publicSale(commitSale(current,input,await loadPools(current),token,key,actor.name));});return NextResponse.json({sale:result});
 }
 if(user.role!=='Admin')return NextResponse.json({error:'Owner access required to change purchase costs or cancel sales.'},{status:403});
 const result=await mutate(async current=>{
  const actor=await session(current);if(!actor||actor.role!=='Admin')throw Error('Permission denied');
  if(action==='batch-cost'){
   const id=z.string().parse(body.batchId),batch=current.batches.find(batch=>batch.id===id);if(!batch)throw Error('Upload not found.');const old=batch.purchase;
   batch.purchase=purchaseCost(parsePrice(z.string().parse(body.price)),z.enum(['accepted','uploaded']).parse(body.basis),batch.valid,batch.total);
   current.audit.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),by:actor.name,role:actor.role,action:'Purchase cost updated',old:{id,price:old},next:{id,price:batch.purchase}});return {ok:true};
  }
  if(action==='opening-cost'){
   const parsed=row.extend({label:z.string().trim().min(1).max(120)}).parse(body.input);const purchase=recordOpeningCost(current,{...parsed,unitPricePaise:parsePrice(parsed.price)},await loadPools(current));current.audit.unshift({id:crypto.randomUUID(),at:purchase.at,by:actor.name,role:actor.role,action:'Opening lead purchase recorded',old:null,next:{id:purchase.id,totalPaise:purchase.totalPaise}});return {ok:true};
  }
  if(action==='opening-price'){
   const purchase=current.openingPurchases?.find(purchase=>purchase.id===body.purchaseId);if(!purchase)throw Error('Opening purchase not found.');const old={unitPricePaise:purchase.unitPricePaise,totalPaise:purchase.totalPaise};purchase.unitPricePaise=parsePrice(z.string().parse(body.price));purchase.totalPaise=purchase.unitPricePaise*purchase.keys.length;current.audit.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),by:actor.name,role:actor.role,action:'Opening stock price corrected',old:{id:purchase.id,...old},next:{id:purchase.id,unitPricePaise:purchase.unitPricePaise,totalPaise:purchase.totalPaise}});return {ok:true};
  }
  const sale=current.sales?.find(sale=>sale.id===body.saleId);if(!sale)throw Error('Sale not found.');if(sale.status==='cancelled')return {ok:true};sale.status='cancelled';sale.cancelledAt=new Date().toISOString();current.audit.unshift({id:crypto.randomUUID(),at:sale.cancelledAt,by:actor.name,role:actor.role,action:'Lead sale cancelled',old:{id:sale.id,totalPaise:sale.totalPaise},next:{id:sale.id,status:'cancelled'}});return {ok:true};
 });return NextResponse.json(result);
 }catch(error){return NextResponse.json({error:error instanceof z.ZodError?'Check the buyer, language, range, quantity and price.':error instanceof Error?error.message:'Sales request failed'},{status:400})}}
