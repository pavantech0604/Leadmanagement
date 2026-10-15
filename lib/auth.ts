import {cookies} from 'next/headers';
import {SignJWT,jwtVerify} from 'jose';
import {randomBytes} from 'node:crypto';
import {Store} from './types';
const secret=new TextEncoder().encode(process.env.SESSION_SECRET||randomBytes(32).toString('hex'));
export async function session(s:Store){const token=(await cookies()).get('bf-session')?.value;if(!token)return null;try{const {payload}=await jwtVerify(token,secret);return s.users.find(u=>u.id===payload.sub)||null}catch{return null}}
export async function signIn(id:string){const token=await new SignJWT({}).setProtectedHeader({alg:'HS256'}).setSubject(id).setExpirationTime('8h').sign(secret);(await cookies()).set('bf-session',token,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',path:'/',maxAge:28800})}
