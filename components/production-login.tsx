'use client';
import {useState} from 'react';
import {ArrowRight,Eye,EyeOff,Loader2,AlertCircle} from 'lucide-react';
export function ProductionLogin({signedIn}:{signedIn:()=>Promise<void>}){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[code,setCode]=useState(''),[showPassword,setShowPassword]=useState(false),[needsMfa,setNeedsMfa]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(event:React.FormEvent){
  event.preventDefault();if(busy)return;setBusy(true);setError('');
  try{
   const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,...(needsMfa?{code}: {})}),cache:'no-store'});
   const result=await response.json();
   if(!response.ok){if(result.needsMfa)setNeedsMfa(true);throw Error(result.error||'Unable to sign in. Please retry.');}
   setPassword('');setCode('');await signedIn();
  }catch(error){setError(error instanceof Error?error.message:'Unable to reach sign-in. Please check your connection and retry.');}finally{setBusy(false)}
 }
 return <form className="production-login" onSubmit={submit} aria-label="Secure workspace sign-in">
  <label htmlFor="workspace-email">Work email</label><input id="workspace-email" name="email" type="email" autoComplete="username" inputMode="email" placeholder="Your authorized email" value={email} disabled={busy} required maxLength={254} onChange={event=>{setEmail(event.target.value);setNeedsMfa(false);setCode('')}}/>
  <label htmlFor="workspace-password">Password</label><div className="production-password"><input id="workspace-password" name="password" type={showPassword?'text':'password'} autoComplete="current-password" placeholder="Your account password" value={password} disabled={busy} required maxLength={1024} onChange={event=>setPassword(event.target.value)}/><button type="button" aria-label={showPassword?'Hide password':'Show password'} aria-pressed={showPassword} onClick={()=>setShowPassword(value=>!value)}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>
  {needsMfa&&<><label htmlFor="workspace-code">Authenticator code</label><input id="workspace-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="6-digit code" value={code} disabled={busy} required onChange={event=>setCode(event.target.value.replace(/\D/g,''))}/></>}
  {error&&<div className="production-login-error" role="alert"><AlertCircle size={16}/><span>{error}</span></div>}
  <button type="submit" className="entry-primary" disabled={busy}>{busy?<><Loader2 size={18} className="spin"/>Signing in…</>:<>Sign in to my workspace<ArrowRight size={18}/></>}</button>
  <p className="production-login-help">Access is limited to approved workspace accounts. Contact your workspace owner if you need an account or password reset.</p>
 </form>;
}
