import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {cloudQuery} from './cloud-database';
import type {Store,User} from './types';
export class SignInError extends Error{constructor(message:string,public status=401,public needsMfa=false){super(message)}}
export type Credentials={email:string;password:string;code?:string};
export type Membership={email:string;auth_user_id:string|null;app_user_id:string;name:string;role:User['role'];branch_ids:string[];active:boolean};
export function productionAuthClient(){
 const url=process.env.SUPABASE_URL||'https://taxqsqczqtvlzcblmlig.supabase.co';
 const key=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY;
 if(!key)throw new SignInError('Secure sign-in needs SUPABASE_PUBLISHABLE_KEY configured in Vercel. Add the project publishable key, then redeploy.',503);
 let parsed:URL;try{parsed=new URL(url)}catch{throw new SignInError('The Supabase authentication URL is invalid.',503)}
 if(parsed.origin!=='https://taxqsqczqtvlzcblmlig.supabase.co'||parsed.pathname!=='/'||parsed.search||parsed.hash)throw new SignInError('The authentication URL must match this workspace’s Supabase project.',503);
 let legacyRole:string|undefined;try{legacyRole=JSON.parse(Buffer.from(key.split('.')[1]||'','base64url').toString()).role}catch{/* Publishable keys are opaque; only legacy JWT keys contain a role. */}
 if(key.startsWith('sb_secret_')||legacyRole==='service_role')throw new SignInError('Use the publishable or anon key for sign-in, not a secret service key.',503);
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(15000),cache:'no-store'})}});
}
export function memberUser(member:Membership|undefined,authId:string,email:string,s:Store):User|null{
 if(!member?.active||member.email!==email.toLowerCase()||member.auth_user_id&&member.auth_user_id!==authId)return null;
 const existing=s.users.find(user=>user.id===member.app_user_id);if(!existing)return null;
 return {...existing,name:member.name,email:member.email,role:member.role,branchIds:member.branch_ids};
}
type Query=(sql:string,values?:unknown[])=>Promise<{rows:Membership[]}>;
export async function authenticateCredentials(credentials:Credentials,s:Store,client:SupabaseClient=productionAuthClient(),query:Query=cloudQuery){
 const email=credentials.email.trim().toLowerCase();
 const {data,error}=await client.auth.signInWithPassword({email,password:credentials.password});
 if(error||!data.session)throw new SignInError('Email or password is incorrect, or the account is not confirmed.');
 const verified=await client.auth.getUser(data.session.access_token);
 let identity=verified.data.user;
 if(verified.error||!identity?.email||!identity.email_confirmed_at)throw new SignInError('Email or password is incorrect, or the account is not confirmed.');
 const factor=identity.factors?.find(factor=>factor.status==='verified');
 if(factor){
  if(factor.factor_type!=='totp')throw new SignInError('This account requires an MFA method that is not supported by this sign-in form. Contact the workspace owner.',403);
  if(!credentials.code)throw new SignInError('Enter the six-digit code from your authenticator app.',401,true);
  const challenge=await client.auth.mfa.challengeAndVerify({factorId:factor.id,code:credentials.code});
  if(challenge.error||!challenge.data)throw new SignInError('The authenticator code is invalid or expired. Try a new code.',401,true);
  const elevated=await client.auth.getUser();if(elevated.error||!elevated.data.user)throw new SignInError('Could not verify the secure session. Try signing in again.');identity=elevated.data.user;
 }
 const verifiedEmail=identity.email!.toLowerCase();
 if(verifiedEmail!==email)throw new SignInError('This account is not authorized for the workspace.',403);
 const {rows}=await query('select email,auth_user_id,app_user_id,name,role,branch_ids,active from capital_grow.memberships where email=$1 and active=true',[verifiedEmail]);
 const user=memberUser(rows[0],identity.id,verifiedEmail,s);if(!user)throw new SignInError('This account is not authorized for the workspace.',403);
 const binding=await query('update capital_grow.memberships set auth_user_id=$1 where email=$2 and active=true and (auth_user_id is null or auth_user_id=$1) returning email,auth_user_id,app_user_id,name,role,branch_ids,active',[identity.id,verifiedEmail]);
 if(!binding.rows.length)throw new SignInError('This account is not authorized for the workspace.',403);
 return {user,authId:identity.id,email:verifiedEmail};
}
