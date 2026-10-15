export class DeploymentError extends Error{readonly status=503;constructor(message:string){super(message);this.name='DeploymentError'}}
export function useCloudStorage(){
 const backend=process.env.STORAGE_BACKEND;
 if(backend&&backend!=='local'&&backend!=='supabase')throw new DeploymentError('STORAGE_BACKEND must be local or supabase.');
 if(process.env.VERCEL&&backend!=='supabase')throw new DeploymentError('This Vercel deployment needs persistent storage. Set STORAGE_BACKEND=supabase and SUPABASE_DATABASE_URL in Vercel, initialize the private workspace, then redeploy. Local workspace files cannot be stored on Vercel.');
 if(backend==='supabase'){
  if(!process.env.SUPABASE_DATABASE_URL)throw new DeploymentError('Set the server-only SUPABASE_DATABASE_URL environment variable in Vercel, then redeploy. The Supabase project URL is not a database connection string.');
  if(!process.env.SESSION_SECRET||process.env.SESSION_SECRET.length<32)throw new DeploymentError('Set SESSION_SECRET to a stable random secret of at least 32 characters, then redeploy.');
  return true;
 }
 return false;
}
export function workspaceFailure(error:unknown){
 if(error instanceof DeploymentError)return {status:503,message:error.message};
 const code=(error as {code?:string})?.code;
 if(code==='42P01'||code==='3F000')return {status:503,message:'The private Supabase workspace schema is missing. Apply the supplied migrations and initialize the workspace before using this deployment.'};
 if(code==='28P01'||code==='42501')return {status:503,message:'The server database connection or its workspace permissions need attention. Check the restricted application database role in Vercel.'};
 return {status:503,message:'The workspace could not connect to its storage. Check Vercel runtime logs and the server database environment settings, then retry.'};
}
