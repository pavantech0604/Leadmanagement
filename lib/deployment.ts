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
 const candidate=error as {code?:string;cause?:{code?:string};message?:string};
 const code=candidate?.code||candidate?.cause?.code;
 if(['ENETUNREACH','EHOSTUNREACH','ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ETIMEDOUT'].includes(code||'')||/connection timeout|timeout exceeded when trying to connect/i.test(candidate?.message||''))return {status:503,message:'The server cannot reach the database. Use the IPv4-compatible Session pooler URI from Supabase Connect (port 5432), check its host, and confirm the project is running and network restrictions allow this deployment.'};
 if(['SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED'].includes(code||''))return {status:503,message:'Database TLS certificate verification failed. Configure the trusted Supabase database CA using the server-only SUPABASE_DB_CA_CERT variable (or SUPABASE_DB_CA_PATH). Keep certificate verification enabled.'};
 if(code==='53300')return {status:503,message:'The database connection limit is reached. Use the Supabase session pooler and retry after existing connections close.'};
 if(code==='42P01'||code==='3F000')return {status:503,message:'The private Supabase workspace schema is missing. Apply the supplied migrations and initialize the workspace before using this deployment.'};
 if(code==='28P01'||code==='42501')return {status:503,message:'The server database connection or its workspace permissions need attention. Check the restricted application database role in Vercel.'};
 return {status:503,message:'The workspace could not connect to its storage. Check Vercel runtime logs and the server database environment settings, then retry.'};
}

export function databaseConnectionUrl(value:string){
 const clean=value.trim();
 let url:URL;try{url=new URL(clean)}catch{throw new DeploymentError('SUPABASE_DATABASE_URL is not a valid PostgreSQL connection string. Copy the session-pooler URI from Supabase Connect and replace its password placeholder.');}
 if(!['postgres:','postgresql:'].includes(url.protocol))throw new DeploymentError('SUPABASE_DATABASE_URL must begin with postgresql://, not https://. Use Supabase Connect → Session pooler, not the project API URL.');
 if(!url.username||!url.password||/\[.*\]|YOUR[-_ ]?PASSWORD|<.*>/i.test(decodeURIComponent(url.password)))throw new DeploymentError('The PostgreSQL connection string still needs its database username and password. Replace the password placeholder privately in Vercel.');
 const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(!local&&!url.hostname.endsWith('.supabase.co')&&!url.hostname.endsWith('.pooler.supabase.com'))throw new DeploymentError('The database host is not a Supabase endpoint. Copy the complete PostgreSQL session-pooler URI from your Supabase project.');
 return url;
}
