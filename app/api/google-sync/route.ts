import {NextRequest,NextResponse,after} from 'next/server';
import {readStore} from '@/lib/store';
import {session} from '@/lib/auth';
import {canTransfer} from '@/lib/permissions';
import {googleConnectionStatus,prepareGoogleConnection,connectGoogle,runGoogleSyncQueue} from '@/lib/google-sync';
export const runtime='nodejs';
export const maxDuration=120;
export async function GET(){const s=await readStore(),u=await session(s);if(!u||!canTransfer(u))return NextResponse.json({error:'Workspace access required'},{status:403});const status=await googleConnectionStatus();const pending=s.batches.filter(b=>!b.googleSync&&b.poolAppends?.length&&b.valid>0);if(status.connected&&pending.length)after(()=>runGoogleSyncQueue());return NextResponse.json({...status,pending:pending.length,jobs:pending.map(b=>({id:b.id,file:b.file,...b.syncJob}))});}
export async function POST(req:NextRequest){try{
 const origin=req.headers.get('origin');if(origin&&new URL(origin).host!==req.headers.get('host'))throw Error('Invalid origin');
 const s=await readStore(),u=await session(s);if(!u||!canTransfer(u))return NextResponse.json({error:'Workspace access required'},{status:403});
 const b=await req.json();
 if(b.action==='retry'){after(()=>runGoogleSyncQueue(true));return NextResponse.json({queued:true});}
 if(u.role!=='Admin')return NextResponse.json({error:'Owner access required'},{status:403});
 if(b.action==='prepare')return NextResponse.json({script:await prepareGoogleConnection()});
 if(b.action==='connect'){if(typeof b.url!=='string'||b.url.length>400)throw Error('Invalid connection URL');await connectGoogle(b.url.trim());after(()=>runGoogleSyncQueue(true));return NextResponse.json({connected:true});}
 throw Error('Unknown connection action');
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Google sync failed'},{status:400});}}
