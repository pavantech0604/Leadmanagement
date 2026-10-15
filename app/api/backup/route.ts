import {NextResponse} from 'next/server';
import {readStore} from '@/lib/store';
import {session} from '@/lib/auth';
import {buildBackupWorkbook,latestBackup} from '@/lib/backups';
export const runtime='nodejs';
export async function GET(req:Request){const s=await readStore();const user=await session(s);if(!user)return NextResponse.json({error:'Sign in required'},{status:401});if(user.role!=='Admin')return NextResponse.json({error:'Owner access required for full backup'},{status:403});if(new URL(req.url).searchParams.get('status'))return NextResponse.json({latest:await latestBackup(),mode:'Automatic local snapshots; no Google write-back'});try{const workbook=await buildBackupWorkbook(s,undefined,true);return new NextResponse(new Uint8Array(workbook),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="capital-grow-complete-workspace.xlsx"','Cache-Control':'no-store'}})}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Export failed. Please try again.'},{status:503})}}
