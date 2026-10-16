import {cookies} from 'next/headers';
import {SignJWT,jwtVerify} from 'jose';
import {randomBytes} from 'node:crypto';
import {cloudEnabled,cloudQuery} from './cloud-database';
import {memberUser,type Membership} from './production-auth';
import {Store} from './types';
const secret=new TextEncoder().encode(process.env.SESSION_SECRET||randomBytes(32).toString('hex'));
const issuer='capital-grow',audience='capital-grow-workspace';
export async function session(s:Store){const token=(await cookies()).get('bf-session')?.value;if(!token)return null;try{
 const {payload}=await jwtVerify(token,secret,{algorithms:['HS256'],issuer,audience});
 if(cloudEnabled()||process.env.NODE_ENV==='production'){
  if(payload.method!=='supabase'||typeof payload.authId!=='string'||typeof payload.email!=='string')return null;
  const {rows}=await cloudQuery('select email,auth_user_id,app_user_id,name,role,branch_ids,active from capital_grow.memberships where auth_user_id=$1 and active=true',[payload.authId]);
  const member=rows[0] as Membership|undefined;if(!member||member.app_user_id!==payload.sub)return null;
  return memberUser(member,payload.authId,payload.email,s);
 }
 return s.users.find(u=>u.id===payload.sub)||null;
 }catch{return null}}
export async function signIn(id:string,identity?:{authId:string;email:string}){
 if((cloudEnabled()||process.env.NODE_ENV==='production')&&!identity)throw Error('Verified Supabase identity required.');
 const token=await new SignJWT(identity?{method:'supabase',...identity}:{method:'local'}).setProtectedHeader({alg:'HS256'}).setIssuer(issuer).setAudience(audience).setSubject(id).setIssuedAt().setExpirationTime('1h').sign(secret);
 (await cookies()).set('bf-session',token,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',path:'/',maxAge:3600});
}
