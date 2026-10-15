import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {mutate,readStore} from '@/lib/store';
import {session} from '@/lib/auth';
import {canTransfer,commitTransfer,loadPools,previewTransfer,publicTransfer,replayTransfer,TransferError,type TransferInput} from '@/lib/transfers';
export const runtime='nodejs';
const inputSchema=z.object({mode:z.enum(['fresh','reuse']).optional(),reuseAcknowledged:z.boolean().optional(),floor:z.string().trim().min(1).max(100),requests:z.array(z.object({language:z.enum(['Telugu','Tamil','Kannada','Malayalam','Hindi']),quantity:z.number().int().min(1).max(10000),start:z.number().int().min(1).max(1000000).optional()})).min(1).max(5),initialFile:z.string().trim().max(180).optional()});
export async function GET(req:NextRequest){const s=await readStore(),u=await session(s);if(!u)return NextResponse.json({error:'Unauthorized'},{status:401});if(!canTransfer(u))return NextResponse.json({error:'Permission denied'},{status:403});const page=Math.max(1,Number(req.nextUrl.searchParams.get('page'))||1),query=(req.nextUrl.searchParams.get('q')||'').toLowerCase(),floor=req.nextUrl.searchParams.get('floor');const records=(s.transfers||[]).filter(t=>(!floor||t.floor===floor)&&(!query||`${t.id} ${t.floor} ${t.file} ${t.by} ${t.at} ${t.allocations.map(a=>`${a.language} ${a.start}-${a.end}`).join(' ')}`.toLowerCase().includes(query))).sort((a,b)=>b.at.localeCompare(a.at));return NextResponse.json({total:records.length,page,records:records.slice((page-1)*25,page*25).map(publicTransfer)})}
export async function POST(req:NextRequest){let attempted:{input:TransferInput;key:string}|undefined;try{
 const origin=req.headers.get('origin');if(origin&&new URL(origin).host!==req.headers.get('host'))throw new TransferError('Invalid origin',403);
 const body=await req.json(),action=z.enum(['preview','commit']).parse(body.action),input=inputSchema.parse(body.input);
 if(input.requests.reduce((n,r)=>n+r.quantity,0)>10000)throw new TransferError('At most 10,000 leads per transfer.',400);
 if(action==='preview'){const s=await readStore(),u=await session(s);if(!u)throw new TransferError('Unauthorized',401);if(!canTransfer(u))throw new TransferError('Permission denied',403);return NextResponse.json({preview:previewTransfer(s,input,await loadPools(s))})}
 const key=z.string().uuid().parse(body.key),token=z.string().length(64).parse(body.token);
 attempted={input,key};
 const result=await mutate(async s=>{const u=await session(s);if(!u)throw new TransferError('Unauthorized',401);if(!canTransfer(u))throw new TransferError('Permission denied',403);const replay=replayTransfer(s,u,key,input);if(replay)return {transfer:publicTransfer(replay),replayed:true};const committed=commitTransfer(s,u,input,await loadPools(s),token,key);return {...committed,transfer:publicTransfer(committed.transfer)}});
 return NextResponse.json(result);
 }catch(e){const message=e instanceof z.ZodError?'Check the floor, language, quantity and filename values.':e instanceof Error?e.message:'Transfer failed';
 if(attempted&&!(e instanceof TransferError&&[401,403].includes(e.status))){const rejected=attempted;await mutate(async s=>{const u=await session(s);if(!u||!canTransfer(u))return;s.audit.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),by:u.name,role:u.role,action:'Floor transfer rejected',old:null,next:{status:'failed',key:rejected.key,floor:rejected.input.floor,requests:rejected.input.requests,reason:message}})}).catch(()=>{});}
 return NextResponse.json({error:message}, {status:e instanceof TransferError?e.status:400})}}
