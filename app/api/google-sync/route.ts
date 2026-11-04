import {NextRequest,NextResponse,after} from 'next/server';
import {refreshMasterInBackground,masterRefreshStatus} from '@/lib/master-cache';
import {cloudEnabled,readCloudSyncStatus,readCloudImportStore} from '@/lib/cloud-database';
import {readStore} from '@/lib/store';
import {session} from '@/lib/auth';
import {canTransfer} from '@/lib/permissions';
import {googleConnectionStatus,prepareGoogleConnection,connectGoogle,runGoogleSyncQueue,googleQueueError} from '@/lib/google-sync';
export const runtime='nodejs';
export const maxDuration=120;
const statusJson=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(){try{
 const s=cloudEnabled()?await readCloudSyncStatus():await readStore(),u=await session(s);
 if(!u||!canTransfer(u))return statusJson({error:'Workspace access required'},403);
 after(()=>refreshMasterInBackground(cloudEnabled()?readCloudImportStore:s));
 const status=await googleConnectionStatus();
 const pending=s.batches.filter(b=>!b.googleSync&&(b.appendRanges?.length||b.poolAppends?.length)&&b.valid>0).sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
 if(status.connected&&pending.length)after(()=>runGoogleSyncQueue());
 return statusJson({...status,...masterRefreshStatus(),queueError:googleQueueError(),registerUpdatedAt:s.operationsSyncAt??null,pending:pending.length,jobs:pending.map(b=>({id:b.id,file:b.file,...b.syncJob}))});
 }catch{return statusJson({error:'Sync status is temporarily unavailable.'},503);}}
export async function POST(req:NextRequest){try{
 const origin=req.headers.get('origin');if(origin&&new URL(origin).host!==req.headers.get('host'))throw Error('Invalid origin');
 const s=cloudEnabled()?await readCloudSyncStatus():await readStore(),u=await session(s);if(!u||!canTransfer(u))return NextResponse.json({error:'Workspace access required'},{status:403});
 const b=await req.json();
 if(b.action==='refresh-register'){after(()=>refreshMasterInBackground(cloudEnabled()?readCloudImportStore:s,true));return statusJson({queued:true});}
 if(b.action==='retry'){if(!(await googleConnectionStatus()).connected)throw Error('Connect Google Sheets before retrying.');after(()=>runGoogleSyncQueue(true));return NextResponse.json({queued:true});}
 if(u.role!=='Admin')return NextResponse.json({error:'Owner access required'},{status:403});
 if(b.action==='prepare')return NextResponse.json({script:await prepareGoogleConnection()});
 if(b.action==='connect'){if(typeof b.url!=='string'||b.url.length>400)throw Error('Invalid connection URL');await connectGoogle(b.url.trim());after(()=>runGoogleSyncQueue(true));return NextResponse.json({connected:true});}
 throw Error('Unknown connection action');
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Google sync failed'},{status:400});}}
