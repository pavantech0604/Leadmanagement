import {NextRequest,NextResponse} from 'next/server';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {authenticateCredentials,SignInError} from '@/lib/production-auth';
import {readStore} from '@/lib/store';
import {signIn} from '@/lib/auth';
import {cloudEnabled,rateLimit,securityEvent} from '@/lib/cloud-database';
export const runtime='nodejs';
export const maxDuration=60;
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(req:NextRequest){
 try{
  const origin=req.headers.get('origin');if(!origin||new URL(origin).host!==req.headers.get('host'))return reply({error:'Invalid request origin.'},403);
  if(!cloudEnabled())return reply({error:'Secure hosted sign-in requires the Supabase storage configuration.'},503);
  const credentials=z.object({email:z.string().trim().email().max(254),password:z.string().min(1).max(1024),code:z.string().regex(/^\d{6}$/).optional()}).safeParse(await req.json());
  if(!credentials.success)return reply({error:'Enter a valid email, password and, if requested, six-digit authenticator code.'},400);
  const address=(req.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim();
  const fingerprint=createHash('sha256').update(address).digest('hex');
  await rateLimit('signin:'+fingerprint,20,600);
  const result=await authenticateCredentials(credentials.data,await readStore());
  await securityEvent(result.authId,'Sign-in succeeded');
  await signIn(result.user.id,{authId:result.authId,email:result.email});return reply({ok:true});
 }catch(error){
  if(error instanceof SignInError)return reply({error:error.message,needsMfa:error.needsMfa},error.status);
  if(error instanceof Error&&error.message.startsWith('Too many requests'))return reply({error:'Too many sign-in attempts. Please wait ten minutes and retry.'},429);
  return reply({error:'Sign-in is temporarily unavailable. Check the authentication and database settings, then retry.'},503);
 }
}
