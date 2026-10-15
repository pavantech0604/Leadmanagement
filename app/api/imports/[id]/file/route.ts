import {NextResponse} from 'next/server';
import {readStore} from '@/lib/store';
import {session} from '@/lib/auth';
import {canTransfer} from '@/lib/permissions';
import {cleanImportWorkbook,importReviewWorkbook} from '@/lib/clean-import';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const s=await readStore(),u=await session(s);
 if(!u)return NextResponse.json({error:'Sign in required'},{status:401});
 const {id}=await params,batch=s.batches.find(b=>b.id===id);
 if(!batch)return NextResponse.json({error:'Import not found'},{status:404});
 if(u.role==='Employee'||!(u.role==='Admin'||(!batch.branchId&&canTransfer(u))||u.branchIds.includes(batch.branchId)))return NextResponse.json({error:'Access denied'},{status:403});
 const review=new URL(request.url).searchParams.has('report');
 const name=(batch.file.replace(/\.(csv|xls|xlsx)$/i,'')+(review?'-report.xlsx':'.xlsx')).replace(/[^a-zA-Z0-9_. -]/g,'_').slice(0,180);
 return new NextResponse(new Uint8Array(review?importReviewWorkbook(batch):cleanImportWorkbook(batch)),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${name}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
