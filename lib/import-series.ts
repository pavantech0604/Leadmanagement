import {createHash} from 'node:crypto';
import type {Store,ImportRow} from './types';
import type {Operation} from './operations';
import type {PoolAppend} from './pool-append';
export type ImportSeries={file:string;series:string;clientId:string;needsInitialFile:boolean;previousFile:string};
const safeFile=(file:string)=>file.length<=180&&!/[<>:"/\\|?*]/.test(file)&&!/^[. ]|[. ]$/.test(file)&&!Array.from(file).some(c=>c.charCodeAt(0)<32)&&! /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(file);
function parts(file:string){if(!safeFile(file))return null;const m=file.match(/^(.*?)(\d+)(?:\.(?:xlsx|xls|csv))?$/i);if(!m||!m[1].trim()||/^\d/.test(m[1])||/\d{4}[-_]\d{2}[-_]$/.test(m[1]))return null;return {prefix:m[1],width:m[2].length,number:Number(m[2])}}
const prefixKey=(prefix:string)=>prefix.trim().replace(/[-_ ]+$/,'').toLowerCase();
export function nextImportSeries(s:Pick<Store,'batches'|'operations'>,initialFile='',external:Operation[]=[],sourceFile=''):ImportSeries{
 const receipts=[...(s.operations||[]),...external].filter(r=>r.kind==='receipt');
 const seriesOf=(r:Operation)=>r.displaySeries||s.batches.find(b=>b.id===r.series)?.googleSync?.series||r.series;
 const ordered=receipts.filter(r=>/^\d+$/.test(seriesOf(r))&&Number.isSafeInteger(Number(seriesOf(r)))).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt)||b.sourceRow-a.sourceRow);
 const incoming=parts(sourceFile);
 const matches=(r:Operation,prefix:string)=>prefixKey(parts(r.file)?.prefix||'')===prefixKey(prefix)||prefixKey(r.clientId)===prefixKey(prefix);
 const latest=(incoming?ordered.find(r=>matches(r,incoming.prefix)):undefined)||ordered.find(r=>matches(r,'mmsoctm'));
 let prefix='',width=3,number=1;
 if(latest){const parsed=parts(latest.file);prefix=parsed?.prefix||latest.clientId.trim();width=parsed?.width||2;
  if(!prefix||!safeFile(prefix+'01.xlsx'))prefix='';
  if(prefix){const matching=ordered.filter(r=>matches(r,prefix));number=Math.max(...matching.map(r=>Number(seriesOf(r))))+1;
   for(const r of receipts){const p=parts(r.file);if(p&&prefixKey(p.prefix)===prefixKey(prefix)){number=Math.max(number,p.number+1);width=Math.max(width,p.width)}}
   for(const b of s.batches){const p=parts(b.file);if(p&&prefixKey(p.prefix)===prefixKey(prefix)){number=Math.max(number,p.number+1);width=Math.max(width,p.width)}}
  }
 }
 const needsInitialFile=!prefix;
 if(needsInitialFile){const parsed=parts(initialFile.trim());if(!parsed)return {file:'',series:'',clientId:'',needsInitialFile:true,previousFile:latest?.file||''};prefix=parsed.prefix;width=parsed.width;number=parsed.number;}
 if(!Number.isSafeInteger(number)||number<1)throw new Error('Import series is out of range. Choose a new series.');
 const file=prefix+String(number).padStart(width,'0')+'.xlsx';
 if(!safeFile(file))throw new Error('Import filename is invalid.');
 if([...receipts.map(r=>r.file),...s.batches.map(b=>b.file)].some(f=>f.toLowerCase()===file.toLowerCase()))throw new Error('This import filename already exists. Choose a higher series number.');
 return {file,series:String(number),clientId:latest?.clientId||prefix.replace(/[-_ ]+$/,''),needsInitialFile,previousFile:latest?.file||''};
}
export function importPreviewToken(rows:ImportRow[],appends:PoolAppend[],series:ImportSeries,sourceFile=''){return createHash('sha256').update(JSON.stringify({sourceFile,rows:rows.map(r=>({row:r.row,raw:r.raw,name:r.name,phone:r.phone,email:r.email,language:r.language,state:r.state,reason:r.reason})),appends:appends.map(a=>({language:a.language,start:a.start,count:a.cells.length})),series})).digest('hex')}
