import {NextResponse} from 'next/server';
import {readStore} from '@/lib/store';
import {session} from '@/lib/auth';
import {canTransfer} from '@/lib/transfers';
export const runtime='nodejs';
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){const s=await readStore(),u=await session(s);if(!u)return NextResponse.json({error:'Unauthorized'},{status:401});if(!canTransfer(u))return NextResponse.json({error:'Permission denied'},{status:403});const {id}=await params,t=s.transfers?.find(x=>x.id===id);if(!t)return NextResponse.json({error:'Transfer not found'},{status:404});return new NextResponse(Buffer.from(t.artifact,'base64'),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="transfer.xlsx"; filename*=UTF-8''${encodeURIComponent(t.file)}`,'Cache-Control':'private, no-store'}})}
