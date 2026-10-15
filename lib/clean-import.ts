import * as XLSX from 'xlsx';
import type {Batch} from './types';
import {poolMap} from './pool-append';
export function cleanImportWorkbook(batch:Batch){
 const w=XLSX.utils.book_new();
 for(const language of new Set(batch.rows.filter(r=>r.state==='Valid').map(r=>r.language))){
  const allocation=batch.poolAppends?.find(a=>a.language===language);
  const rows=batch.rows.filter(r=>r.state==='Valid'&&r.language===language).map((r,i)=>({...r.raw,'Lead name':r.name,'Normalized phone':r.phone,'Detected language':r.language,'Original upload row':r.row,'Destination sheet':poolMap[language]?.sheet||'','Destination row':allocation?allocation.start+i:'','Original filename':batch.sourceFile||batch.file}));
  const sheet=XLSX.utils.json_to_sheet(rows);sheet['!cols']=Object.keys(rows[0]||{}).map(()=>({wch:24}));XLSX.utils.book_append_sheet(w,sheet,language.slice(0,31));
 }
 XLSX.utils.book_append_sheet(w,XLSX.utils.json_to_sheet([{File:batch.file,'Original file':batch.sourceFile||batch.file,Series:batch.series||batch.googleSync?.series||'',Uploaded:batch.total,'New leads':batch.valid,'Duplicates excluded':batch.duplicates,'Invalid rows excluded':batch.errors,'Existing unique phones checked':batch.checkedExisting??'',Date:batch.at}]),'Import summary');
 return Buffer.from(XLSX.write(w,{type:'buffer',bookType:'xlsx',compression:true}));
}
export function importReviewWorkbook(batch:Batch){const w=XLSX.utils.book_new();const rows=batch.rows.map(r=>({...r.raw,'Upload row':r.row,'Detected language':r.language,Result:r.state,Details:r.reason}));XLSX.utils.book_append_sheet(w,XLSX.utils.json_to_sheet(rows),'Import review');return Buffer.from(XLSX.write(w,{type:'buffer',bookType:'xlsx',compression:true}));}
