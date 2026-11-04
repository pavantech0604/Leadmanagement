import {timingSafeEqual} from 'node:crypto';
import {runGoogleSyncQueue,googleConnectionStatus,googleQueueError} from '@/lib/google-sync';
import {readStore} from '@/lib/store';
import {refreshMasterInBackground} from '@/lib/master-cache';

export const runtime='nodejs';
export const maxDuration=120;
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});

export async function GET(request:Request){
 const secret=process.env.CRON_SECRET;
 const actual=Buffer.from(request.headers.get('authorization')||'');
 const expected=Buffer.from(`Bearer ${secret||''}`);
 if(!secret||actual.length!==expected.length||!timingSafeEqual(actual,expected))return reply({error:'Unauthorized'},401);
 try{
  const status=await googleConnectionStatus();
  await Promise.all([refreshMasterInBackground(await readStore(),true),status.connected?runGoogleSyncQueue():Promise.resolve()]);
  const current=await readStore();
  const pending=current.batches.filter(batch=>!batch.googleSync&&batch.valid>0&&batch.poolAppends?.length).length;
  return reply({pending,configured:status.connected},!status.connected||googleQueueError()||pending?503:200);
 }catch{return reply({error:'Scheduled sync did not complete'},503);}
}
