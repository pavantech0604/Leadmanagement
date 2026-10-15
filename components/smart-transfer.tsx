'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  Layers,
  Loader2,
  X,
  Building2,
  Sliders,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import type {Operation} from '@/lib/operations';
import type {User} from '@/lib/types';
import type {TransferInput,TransferPreview} from '@/lib/transfers';

const languages=['Telugu','Tamil','Kannada','Malayalam','Hindi'];
const standardFloors=['CG Floor','Fin Floor','MMS Floor'];
const rowNumber=(row:number|null|undefined)=>row==null?'—':row.toLocaleString('en-IN');
type Summary={id:string;file:string;floor:string;quantity:number;by:string;at:string};
type Props={records:Operation[];user:User;initialFloor?:string;close:()=>void;refresh:()=>Promise<unknown>;notify:(text:string)=>void};
const draftKey='capital-grow-transfer-draft-v2';

export function SmartTransfer({records,user,initialFloor='',close,refresh,notify}:Props){
 const [input,setInput]=useState<TransferInput>({
   floor:initialFloor||'CG Floor',
   requests:[{language:'Telugu',quantity:1000}],
   initialFile:''
 });
 const [historySearch,setHistorySearch]=useState('');
 const [lastPreview,setLastPreview]=useState<TransferPreview|null>(null);
 const [preview,setPreview]=useState<TransferPreview|null>(null);
 const [calculating,setCalculating]=useState(false);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const [committed,setCommitted]=useState<Summary|null>(null);
 const [ready,setReady]=useState(false);
 const [tick,setTick]=useState(0);
 const [showRowOverride,setShowRowOverride]=useState(false);

 const pending=useRef<{key:string;token:string;input:TransferInput}|null>(null);
 const dialog=useRef<HTMLElement>(null);
 const generation=useRef(0);
 const inFlight=useRef(false);
 const [uncertain,setUncertain]=useState(false);

 const filePreview=(preview||lastPreview)?.floor===input.floor.trim()?preview||lastPreview:null;
 const floors=useMemo(()=>Array.from(new Set([...standardFloors,...records.filter(r=>r.kind==='dispatch'&&r.floor).map(r=>r.floor)])).sort(),[records]);

 // Helper: Calculate language floor usage and global max from records client-side
 function getLanguageMeta(lang:string){
   let globalMax=0,globalLastFloor='';
   for(const r of records){
     if(r.kind!=='dispatch')continue;
     for(const seg of r.segments){
       if(seg.language===lang&&seg.start!=null&&seg.end!=null&&seg.count!=null){
         if(seg.end>globalMax){
           globalMax=seg.end;
           globalLastFloor=r.floor||'';
         }
       }
     }
   }
   return {
     globalMax,
     globalLastFloor,
     recommendedStart:globalMax>0?globalMax+1:1
   };
 }

 useEffect(()=>{
  const oldFocus=document.activeElement as HTMLElement|null;
  const overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  try{
    const saved=JSON.parse(sessionStorage.getItem(draftKey)||'null');
    if(saved?.userId===user.id&&saved.input&&Array.isArray(saved.input.requests)){
      setInput(saved.input);
      if(saved.pending){
        pending.current=saved.pending;
        setUncertain(true);
      }
    } else {
      chooseFloor(initialFloor||'CG Floor');
    }
  }catch{
    chooseFloor(initialFloor||'CG Floor');
  }
  setReady(true);
  dialog.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  return()=>{
    document.body.style.overflow=overflow;
    oldFocus?.focus();
  };
 },[user.id]);

 useEffect(()=>{
   if(ready)sessionStorage.setItem(draftKey,JSON.stringify({userId:user.id,input,pending:pending.current}));
 },[input,ready,user.id,uncertain]);

 useEffect(()=>{
  const n=++generation.current;
  setPreview(null);
  setError('');
  if(!ready||!input.floor.trim()||input.requests.some(r=>!Number.isInteger(r.quantity)||r.quantity<1)||uncertain){
    setCalculating(false);
    return;
  }
  const abort=new AbortController();
  setCalculating(true);
  const timer=setTimeout(async()=>{
    try{
      const res=await fetch('/api/transfers',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'preview',input}),
        signal:abort.signal
      });
      const data=await res.json();
      if(!res.ok)throw new Error(data.error);
      if(n===generation.current){
        setPreview(data.preview);
        setLastPreview(data.preview);
      }
    }catch(e){
      if(!abort.signal.aborted&&n===generation.current)setError((e as Error).message);
    }finally{
      if(n===generation.current)setCalculating(false);
    }
  },200);
  return()=>{
    clearTimeout(timer);
    abort.abort();
  };
 },[input,ready,tick,uncertain]);

 function update(next:TransferInput,keepAcknowledgement=false){
   if(inFlight.current||uncertain)return;
   pending.current=null;
   setPreview(null);
   setInput({...next,reuseAcknowledged:keepAcknowledgement?next.reuseAcknowledged:false});
 }

 function chooseFloor(value:string){
  update({...input,floor:value,initialFile:'',requests:input.requests.map(r=>input.mode==='reuse'?r:{language:r.language,quantity:r.quantity})});
 }
 function toggleLanguage(language:string){
  const selected=input.requests.some(request=>request.language===language);
  if(selected&&input.requests.length===1)return;
  update({...input,requests:selected?input.requests.filter(request=>request.language!==language):[...input.requests,{language,quantity:1000}]});
 }
 function choosePrevious(record:Operation){
  const requests=record.segments.map(s=>({language:s.language,quantity:s.count!,start:s.start!}));
  update({...input,mode:'reuse',requests});
 }
 const previousDeliveries=records.filter(r=>r.kind==='dispatch'&&r.segments.length>0&&r.segments.every(s=>s.start!==null&&s.count!==null&&s.count>0)&&r.segments.reduce((n,s)=>n+(s.count||0),0)<=10000&&(!historySearch||`${r.floor} ${r.file} ${r.date} ${r.segments.map(s=>s.language+' '+s.range).join(' ')}`.toLowerCase().includes(historySearch.toLowerCase()))).slice().sort((a,b)=>b.date.localeCompare(a.date));

 function applyRecommendedStart(index:number,recStart:number){
   update({
     ...input,
     requests:input.requests.map((r,i)=>i===index?{...r,start:recStart}:r)
   });
 }

 async function copyRange(language:string,start:number|null,end:number|null){
  if(start===null||end===null)return;
  try{await navigator.clipboard.writeText(`${start}-${end}`);notify(`${language} range copied: ${start}-${end}`);}
  catch{notify('Could not copy the range. Select the row numbers to copy them.');}
 }

 async function confirm(){
  if(inFlight.current)return;
  if(!pending.current){
    if(!preview||preview.errors.length)return;
    pending.current={key:crypto.randomUUID(),token:preview.token,input:structuredClone(input)};
  }
  const request=pending.current;
  inFlight.current=true;
  setSaving(true);
  setError('');
  sessionStorage.setItem(draftKey,JSON.stringify({userId:user.id,input,pending:request}));
  try{
    const res=await fetch('/api/transfers',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'commit',...request})
    });
    const data=await res.json();
    if(!res.ok){
      pending.current=null;
      setUncertain(false);
      sessionStorage.setItem(draftKey,JSON.stringify({userId:user.id,input,pending:null}));
      setTick(t=>t+1);
      throw new Error(data.error);
    }
    setCommitted(data.transfer);
    setUncertain(false);
    pending.current=null;
    sessionStorage.removeItem(draftKey);
    notify(`${data.transfer.quantity.toLocaleString('en-IN')} leads sent to ${data.transfer.floor} · ${data.transfer.file}`);
    await refresh().catch(()=>setError('Transfer saved. Reopen the daily desk to refresh its totals.'));
  }catch(e){
    if(pending.current)setUncertain(true);
    setError((e as Error).message);
  }finally{
    setSaving(false);
    inFlight.current=false;
  }
 }

 function trap(e:React.KeyboardEvent){
   if(e.key==='Escape'&&!saving){
     close();
     return;
   }
   if(e.key!=='Tab')return;
   const nodes=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,a[href]')||[]);
   const first=nodes[0],last=nodes.at(-1);
   if(e.shiftKey&&document.activeElement===first){
     e.preventDefault();
     last?.focus();
   }else if(!e.shiftKey&&document.activeElement===last){
     e.preventDefault();
     first?.focus();
   }
 }

 return <div className="overlay modal-overlay"><section ref={dialog} className="modal smart-transfer" role="dialog" aria-modal="true" aria-labelledby="smart-transfer-title" onKeyDown={trap}>
 <div className="panel-heading">
   <div>
     <span className="ops-eyebrow">FLOOR LEAD TRANSFER</span>
     <h2 id="smart-transfer-title">{committed?'Transfer complete.':'Send Leads to Floor'}</h2>
   </div>
   <button disabled={saving} aria-label="Close transfer" onClick={close}><X/></button>
 </div>

 {committed?<div className="transfer-success">
   <span><Check size={32}/></span>
   <h3>{committed.quantity.toLocaleString('en-IN')} leads committed</h3>
   <p>Destination: <strong>{committed.floor}</strong> · File: <strong>{committed.file}</strong></p>
   <small>Dispatched by {committed.by} · {new Date(committed.at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</small>
   <a className="button primary" href={`/api/transfers/${committed.id}/file`}><Download size={16}/>Download Excel File (.xlsx)</a>
   <button className="button secondary" onClick={()=>{setCommitted(null);setTick(t=>t+1)}}>Prepare another transfer <ArrowRight size={16}/></button>
   {error&&<p role="alert">{error}</p>}
 </div>:<>
 <div className="transfer-body"><div className="transfer-grid">
   <div className="transfer-config">
     <span className="transfer-step">1 · YOUR REQUEST</span>
     
     {/* Clean Floor Selection Pills */}
     <div className="dispatch-floor">
       <span style={{fontSize:'11px',fontWeight:600,color:'var(--text)',display:'block',marginBottom:'8px'}}>Destination floor</span>
       <div className="floor-tab-group" style={{margin:'0 0 10px'}}>
         {standardFloors.map(f=><button
           key={f}
           type="button"
           className={`floor-tab ${input.floor.toLowerCase()===f.toLowerCase()?'active':''}`}
           disabled={saving||uncertain}
           onClick={()=>chooseFloor(f)}
         >
           <Building2 size={13}/>
           {f}
         </button>)}
       </div>

       <details className="dispatch-custom-floor"><summary>Other floor</summary><input
         list="smart-floor-names"
         value={input.floor}
         disabled={saving||uncertain}
         placeholder="Select or enter floor name"
         onChange={e=>chooseFloor(e.target.value)}
       />
       <datalist id="smart-floor-names">{floors.map(f=><option value={f} key={f}/>)}</datalist></details>
     </div>

     <div className="delivery-mode" aria-label="Delivery mode">
       <button type="button" aria-pressed={input.mode!=='reuse'} disabled={saving||uncertain} onClick={()=>update({...input,mode:'fresh',requests:input.requests.map(r=>({language:r.language,quantity:r.quantity}))})}>Fresh leads<small>Continue to unused rows</small></button>
       <button type="button" aria-pressed={input.mode==='reuse'} disabled={saving||uncertain} onClick={()=>update({...input,mode:'reuse',requests:input.requests.map(r=>({language:r.language,quantity:r.quantity}))})}>Reuse leads<small>Choose earlier ranges</small></button>
     </div>
     {input.mode==='reuse'&&<section className="reuse-picker"><h3>Choose a previous delivery</h3><p>These leads can be sent again immediately. Pick a delivery or enter starting rows below.</p><input aria-label="Search previous deliveries" placeholder="Search floor, file, language or date" value={historySearch} onChange={e=>setHistorySearch(e.target.value)}/><div className="reuse-choices">{previousDeliveries.slice(0,20).map(r=><button type="button" key={r.id} disabled={saving||uncertain} onClick={()=>choosePrevious(r)}><b>{r.file||r.floor}</b><small>{r.floor} · {r.date}</small><span>{r.segments.map(s=>s.language+': '+s.range).join(' · ')}</span></button>)}{!previousDeliveries.length&&<p>No matching delivery. Enter the source rows below.</p>}</div></section>}
     <section className="dispatch-language-picker" aria-labelledby="dispatch-languages-title">
       <div><h3 id="dispatch-languages-title">Requested languages</h3><span>{input.requests.length} selected</span></div>
       <p>Choose languages and enter the requested quantities.</p>
       <div className="dispatch-language-options" role="group" aria-label="Requested languages">
         {languages.map(language=>{
           const selected=input.requests.some(request=>request.language===language);
           return <button type="button" key={language} aria-pressed={selected} disabled={saving||uncertain||(selected&&input.requests.length===1)} onClick={()=>toggleLanguage(language)}>
             <span aria-hidden="true">{selected?<Check size={14}/>:<span className="dispatch-language-plus">+</span>}</span>{language}
           </button>;
         })}
       </div>

     </section>
     <button type="button" className="range-override-toggle dispatch-advanced" disabled={saving||uncertain} aria-expanded={showRowOverride} onClick={()=>setShowRowOverride(value=>!value)}><Sliders size={12}/>{showRowOverride?'Hide source row controls':'Adjust source rows'}{showRowOverride?<ChevronUp size={12}/>:<ChevronDown size={12}/>}</button>
     <div className="transfer-languages">
       {input.requests.map((r,i)=>{
         const meta=getLanguageMeta(r.language);
         const pRow=preview?.rows.find(row=>row.language===r.language);
         const recStart=pRow?.recommendedStart??meta.recommendedStart;
         const isOverridden=r.start!==undefined&&r.start!==recStart;
         

         return <div key={r.language} className="dispatch-request">
           <div className="dispatch-request-main">
             <div className="dispatch-request-language"><span className="language-dot"/><strong>{r.language}</strong></div>
             <label>Leads
               <input aria-label={`${r.language} lead quantity`} disabled={saving||uncertain} type="number" inputMode="numeric" min={1} max={10000} value={r.quantity||''} placeholder="1000" onChange={e=>update({...input,requests:input.requests.map((v,j)=>j===i?{...v,quantity:Number(e.target.value)}:v)})}/>
             </label>
             <button type="button" className="dispatch-remove" disabled={saving||uncertain||input.requests.length===1} aria-label={`Remove ${r.language}`} onClick={()=>update({...input,requests:input.requests.filter((_,j)=>j!==i)})}><X size={17}/></button>
           </div>
           {(showRowOverride||input.mode==='reuse')&&<div className="range-override-box" style={{marginTop:'6px'}}>
             <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
               <input aria-label={`Starting row for ${r.language}`} disabled={saving||uncertain} type="number" min={1} value={r.start??(input.mode==='reuse'?'':recStart)} placeholder={input.mode==='reuse'?'Enter source row':String(recStart)} onChange={e=>update({...input,requests:input.requests.map((v,j)=>j===i?{...v,start:e.target.value?Number(e.target.value):undefined}:v)})}/>
               {isOverridden&&<button type="button" className="button secondary" style={{padding:'7px 10px',fontSize:'9px'}} onClick={()=>applyRecommendedStart(i,recStart)}>
                 Reset
               </button>}
             </div>
           </div>}
         </div>;
       })}

     </div>

     <label className="dispatch-file-label">Delivery file
       <input disabled={saving||uncertain} readOnly={!!filePreview&&!filePreview.fileNeedsInput} placeholder="e.g. CGfloor-117.xlsx" value={filePreview&&!filePreview.fileNeedsInput?filePreview.file:input.initialFile||''} onChange={e=>update({...input,initialFile:e.target.value})}/>
       <small>{filePreview&&!filePreview.fileNeedsInput?'Auto-numbered from previous delivery':'Enter an initial filename; sequence will advance automatically.'}</small>
     </label>
   </div>

   {/* Right side: Clean, Premium Dispatch Preview */}
   <div className="transfer-preview" aria-live="polite" aria-busy={calculating}>
     <span className="transfer-step">2 · REVIEW DELIVERY</span>

     {calculating?<div className="transfer-skeleton">
       <Loader2 className="spin" size={20}/>
       <p>Verifying rows and preparing delivery…</p>
       <i/><i/>
     </div>:preview?<><div className="transfer-filename">
       <small>DISPATCH FILE</small>
       <strong>{preview.file||'Waiting for filename'}</strong>
       <span>To: {input.floor}</span>
     </div>

     {preview.rows.map(row=><div className="transfer-range" key={row.language} style={{marginTop:'16px'}}>
       <b>
         <span>{row.language}</span>
         <small style={{color:'var(--brand-green)',fontWeight:600}}>{row.quantity.toLocaleString('en-IN')} leads</small>
       </b>

       <div className="dispatch-summary-range" aria-label={`${row.language} rows ${row.start??'pending'} to ${row.end??'pending'}`}>
         <span>Rows</span><strong>{rowNumber(row.start)} <span aria-hidden="true">→</span> {rowNumber(row.end)}</strong>
         <button type="button" disabled={row.start===null||row.end===null} aria-label={`Copy ${row.language} range`} onClick={()=>copyRange(row.language,row.start,row.end)}><Copy size={15}/></button>
       </div>
     </div>)}

     <div className="transfer-total" style={{marginTop:'16px',paddingTop:'14px'}}>
       <span>Total delivery<small className="dispatch-language-total">{preview.rows.length} {preview.rows.length===1?'language':'languages'}</small></span>
       <strong style={{fontSize:'16px',color:'var(--text)'}}>{preview.quantity.toLocaleString('en-IN')} leads</strong>
     </div>

     {preview.rows.some(r=>r.deliveryHistory?.length)&&<details className="delivery-history" open={input.mode==='reuse'}><summary>Previous deliveries · {preview.rows.reduce((total,row)=>total+(row.deliveryHistory?.length||0),0)} records</summary><p>Each entry is a delivery, so the same leads may appear more than once.</p><div className="delivery-history-scroll"><table><thead><tr><th>Floor / file</th><th>Date</th><th>Language / rows</th></tr></thead><tbody>{preview.rows.flatMap(r=>(r.deliveryHistory||[]).map((h,i)=><tr key={r.language+h.id+i}><td><b>{h.floor}</b><small>{h.file}</small></td><td>{h.date}</td><td>{h.language}<small>{h.start} - {h.end} · {h.count.toLocaleString()} leads</small></td></tr>))}</tbody></table></div></details>}
     {input.mode==='reuse'&&preview.rows.some(r=>r.reusedCount)&&<label className="reuse-consent"><input type="checkbox" checked={!!input.reuseAcknowledged} disabled={saving||uncertain} onChange={e=>update({...input,reuseAcknowledged:e.target.checked},true)}/><span>I reviewed the previous deliveries and want to send these leads to {input.floor} again.</span></label>}
     {preview.warnings.map((message,i)=><p className="reuse-warning" key={i}>{message}</p>)}
     {preview.errors.length?<div className="transfer-errors">
       {preview.errors.map((v,i)=><p key={i}>{v}</p>)}
     </div>:<div className="transfer-valid" style={{marginTop:'14px'}}>
       <Check size={16}/>{preview.rows.some(r=>r.reusedCount)?'Reuse reviewed · Ready to send':'Range verified · Ready to send'}
     </div>}
     </>:<div className="transfer-empty">
       <Layers size={28}/>
       <h3>Ready to configure</h3>
       <p>Select floor and quantity to see live range calculation.</p>
     </div>}
   </div>
 </div>

 {error&&<div className="transfer-errors" role="alert">{error}</div>}
 {uncertain&&<div className="transfer-warning">A confirmation may have reached the server. Retry to recover safely.</div>}</div>

 <div className="form-actions dispatch-footer">
   <button className="button secondary" disabled={saving} onClick={close}>Cancel</button>
   <button className="button primary" disabled={saving||(!uncertain&&(calculating||!preview||!!preview.errors.length))} onClick={confirm}>
     {saving?<Loader2 className="spin" size={15}/>:<Check size={15}/>} {saving?'Sending…':uncertain?'Recover confirmation':`Send${preview?.quantity?' '+preview.quantity.toLocaleString('en-IN'):''} leads`}
   </button>
 </div>
 </>}
 </section></div>;
}
