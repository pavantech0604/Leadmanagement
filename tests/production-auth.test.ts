import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {authenticateCredentials,memberUser,SignInError,productionAuthClient,type Membership} from '../lib/production-auth';
import {seed} from '../lib/store';
const member:Membership={email:'owner@example.com',auth_user_id:null,app_user_id:'u0',name:'Owner',role:'Admin',branch_ids:[],active:true};
const identity={id:'verified-auth-id',email:member.email,email_confirmed_at:'2026-10-16',factors:[] as {id:string;status:string;factor_type:string}[]};
function client(options:{badPassword?:boolean;unconfirmed?:boolean;mfa?:boolean;badCode?:boolean}={}){
 const user={...identity,...(options.unconfirmed?{email_confirmed_at:null}:{}),factors:options.mfa?[{id:'factor',status:'verified',factor_type:'totp'}]:[]};
 return {auth:{signInWithPassword:async()=>({data:{session:options.badPassword?null:{access_token:'server-token'}},error:options.badPassword?Error('private provider detail'):null}),getUser:async()=>({data:{user},error:null}),mfa:{challengeAndVerify:async()=>({data:options.badCode?null:{access_token:'elevated-token'},error:options.badCode?Error('bad code'):null})}}} as unknown as SupabaseClient;
}
test('verified identity requires active membership and cannot take another bound identity',()=>{
 const s=seed();assert.equal(memberUser(member,identity.id,member.email,s)?.id,'u0');
 for(const value of [{...member,active:false},{...member,auth_user_id:'someone-else'},{...member,app_user_id:'missing-user'},{...member,email:'other@example.com'}])assert.equal(memberUser(value,identity.id,member.email,s),null);
});
test('password verification failure and unconfirmed emails never query workspace membership',async()=>{
 for(const mock of [client({badPassword:true}),client({unconfirmed:true})])await assert.rejects(authenticateCredentials({email:member.email,password:'test-only-password'},seed(),mock,async()=>{throw Error('membership query must not run')}),error=>error instanceof SignInError&&error.status===401&&!error.message.includes('private provider detail'));
});
test('successful sign-in binds the verified auth identity and returns only approved role',async()=>{
 const calls:string[]=[];
 const result=await authenticateCredentials({email:' OWNER@example.com ',password:'test-only-password'},seed(),client(),async(sql)=>{calls.push(sql);return {rows:[member]}});
 assert.equal(result.authId,identity.id);assert.equal(result.user.role,'Admin');assert.equal(result.email,member.email);assert.equal(calls.length,2);assert.ok(calls[1].includes('auth_user_id is null or auth_user_id=$1'));
});
test('unapproved accounts and concurrent identity rebinding fail closed',async()=>{
 for(const query of [async()=>({rows:[] as Membership[]}),async(sql:string)=>({rows:sql.startsWith('select')?[member]:[]})])await assert.rejects(authenticateCredentials({email:member.email,password:'test-only-password'},seed(),client(),query),error=>error instanceof SignInError&&error.status===403);
});
test('MFA cannot be bypassed with only a password or an invalid code',async()=>{
 for(const credentials of [{email:member.email,password:'test-only-password'},{email:member.email,password:'test-only-password',code:'123456'}])await assert.rejects(authenticateCredentials(credentials,seed(),client({mfa:true,badCode:true}),async()=>{throw Error('must not authorize before MFA')}),error=>error instanceof SignInError&&error.needsMfa);
 const result=await authenticateCredentials({email:member.email,password:'test-only-password',code:'654321'},seed(),client({mfa:true}),async()=>({rows:[member]}));assert.equal(result.user.id,'u0');
});

test('authentication setup rejects missing keys and privileged service-role keys',()=>{
 const before={...process.env};try{
  delete process.env.SUPABASE_PUBLISHABLE_KEY;delete process.env.SUPABASE_ANON_KEY;delete process.env.SUPABASE_URL;
  assert.throws(productionAuthClient,error=>error instanceof SignInError&&error.status===503);
  for(const key of ['sb_secret_example','eyJheader.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.signature']){process.env.SUPABASE_PUBLISHABLE_KEY=key;assert.throws(productionAuthClient,/not a secret service key/);}
 }finally{for(const key of ['SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY','SUPABASE_URL']){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key]}}
});
