import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import {detectImportColumns} from './engine';

export type ImportSource={name:string;count:number};
export function parseLeadFile(content:ArrayBuffer,name:string){
 const rows:Record<string,string>[]=[];
 const sources:ImportSource[]=[];
 const warnings:string[]=[];
 const addSheet=(matrix:string[][],sheetName:string)=>{
  const populated=matrix.filter(row=>row.some(cell=>String(cell??'').trim()));
  if(!populated.length){sources.push({name:sheetName,count:0});return}
  let header=0,best=0;
  populated.slice(0,30).forEach((row,index)=>{
   const detected=detectImportColumns(row.map(String));
   const score=(detected.name?3:0)+(detected.phone?3:0)+(detected.state?1:0)+(detected.language?1:0);
   if(score>best){best=score;header=index}
  });
  if(header)warnings.push(`${sheetName}: started at the detected column headings after ${header} introductory rows.`);
  const used=new Set<string>();
  const width=populated.slice(header).reduce((max,row)=>Math.max(max,row.length),0);
  const headings=Array.from({length:width},(_,i)=>{
   const base=String(populated[header][i]??'').trim()||`Column ${i+1}`;
   let unique=base,n=2;while(used.has(unique))unique=`${base} (${n++})`;used.add(unique);return unique;
  });
  const detected=detectImportColumns(headings);
  const sheetRows=populated.slice(header+1).map(values=>{
   const row:Record<string,string>=Object.fromEntries(headings.map((key,i)=>[key,String(values[i]??'')]));
   for(const [field,column] of Object.entries(detected))if(column)row[`Import ${field}`]=row[column];
   return row;
  });
  if(!detected.name||!detected.phone)warnings.push(`${sheetName}: check the customer name and phone column selections before checking duplicates.`);
  sources.push({name:sheetName,count:sheetRows.length});rows.push(...sheetRows);
 };
 if(/\.csv$/i.test(name)){
  const bytes=new Uint8Array(content);
  const encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
  const csv=new TextDecoder(encoding).decode(content).replace(/^\uFEFF/,'');
  // A title above the headings must not confuse automatic delimiter detection.
  const candidates=[',',';','\t','|'].map(delimiter=>{
   const sample=Papa.parse<string[]>(csv,{delimiter,preview:30,skipEmptyLines:'greedy'}).data;
   const score=Math.max(0,...sample.map(row=>{
    const columns=detectImportColumns(row);
    return (columns.name?10:0)+(columns.phone?10:0)+(columns.state?2:0)+Math.min(row.length,5);
   }));
   return {delimiter,score};
  }).sort((a,b)=>b.score-a.score);
  const parsed=Papa.parse<string[]>(csv,{delimiter:candidates[0].delimiter,skipEmptyLines:'greedy'});
  const fatal=parsed.errors.find(error=>error.type==='Quotes');
  if(fatal)throw new Error(`CSV could not be read: ${fatal.message}. Save the file again as CSV or Excel and retry.`);
  addSheet(parsed.data,name);
 }else{
  const workbook=XLSX.read(content,{type:'array'});
  for(const sheetName of workbook.SheetNames){
   const matrix=XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[sheetName],{header:1,defval:'',raw:false,blankrows:false});
   addSheet(matrix,sheetName);
  }
 }
 if(!rows.length)throw new Error('No lead rows found. Include a heading row followed by your customer data.');
 if(rows.length>10000)throw new Error(`This file has ${rows.length.toLocaleString()} rows. Split it into files of up to 10,000 rows.`);
 const columns=Array.from(new Set(rows.flatMap(row=>Object.keys(row))));
 const mapping=detectImportColumns(columns);
 for(const field of Object.keys(mapping) as (keyof typeof mapping)[])if(columns.includes(`Import ${field}`))mapping[field]=`Import ${field}`;
 return {rows,sources,columns,mapping,warnings};
}
