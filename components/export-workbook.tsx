'use client';
import {useState} from 'react';
import {Download,Loader2} from 'lucide-react';

export function ExportWorkbook({notify}:{notify:(message:string)=>void}){
 const [exporting,setExporting]=useState(false);
 async function download(){
  if(exporting)return;
  setExporting(true);
  try{
   const response=await fetch('/api/backup');
   if(!response.ok){const body=await response.json().catch(()=>null);throw new Error(body?.error||'Export failed. Please try again.');}
   const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
   link.href=url;link.download='capital-grow-complete-workspace.xlsx';link.click();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
   notify('Complete workbook downloaded: all language sheets, MMS receipts, floor updates and import history.');
  }catch(error){notify(error instanceof Error?error.message:'Export failed. Please try again.');}
  finally{setExporting(false);}
 }
 return <button className="button secondary" onClick={download} disabled={exporting} title="All language sheets and registers, including older leads. Page filters do not apply." aria-busy={exporting}>{exporting?<Loader2 size={15} className="spin"/>:<Download size={15}/>} {exporting?'Preparing workbook…':'Export all data'}</button>;
}
