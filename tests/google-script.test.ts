import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {googleConnectionScript} from '../lib/google-script';

test('deployed script authenticates, verifies writes, resumes retries and refuses duplicate or occupied destinations',()=>{
 class Sheet{
  rows:unknown[][];notes=new Map<string,string>();max=20;
  constructor(rows:unknown[][]){this.rows=rows;}
  getLastRow(){let n=this.rows.length;while(n&&!(this.rows[n-1]||[]).some(v=>v!==''&&v!==null&&v!==undefined))n--;return n;}
  getLastColumn(){return Math.max(1,...this.rows.map(r=>r.length));}
  getMaxRows(){return this.max;}
  insertRowsAfter(_row:number,count:number){this.max+=count;}
  setRowHeight(){}
  getRange(row:number,column:number,height=1,width=1){const self=this;const range={
   getValues:()=>Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>self.rows[row+i-1]?.[column+j-1]??'')),
   getDisplayValues:()=>range.getValues().map(r=>r.map(String)),
   getNotes:()=>Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>self.notes.get(`${row+i}:${column+j}`)||'')),
   setValues:(rows:unknown[][])=>{rows.forEach((r,i)=>r.forEach((v,j)=>{self.rows[row+i-1]??=[];self.rows[row+i-1][column+j-1]=typeof v==='string'&&v.startsWith("'")?v.slice(1):v;}));return range;},
   copyTo:()=>range,setNumberFormat:()=>range,setNote:(value:string)=>{self.notes.set(`${row}:${column}`,value);return range;}
  };return range;}
 }
 const sheets:Record<string,Sheet>={AP:new Sheet([['NAME','','','PHONE']]),TN:new Sheet([['NAME','','STATE','PIN','PHONE'],['Existing','','TAMIL NADU','600001','9876543200']]),KA:new Sheet([['NAME','','','','PHONE']]),HI:new Sheet([['NAME','','','','','','PHONE']]),KL:new Sheet([['NAME','','','PHONE']]),'MMS LEAD REPORT':new Sheet([['DATE','CLIENT NAME','CLIENT ID','SERIES NO','TELUGU','KANNADA','TAMIL','MALYALAM','HINDI','TOTAL LEAD','FILE NAME']])};
 let opens=0;const token='a'.repeat(64),id='10Cji9fGZenyi4BLnIodt98z8C1iAPTo3yWCPTaNjpoE';
 const context=vm.createContext({ContentService:{MimeType:{JSON:'json'},createTextOutput:(s:string)=>({setMimeType:()=>s})},SpreadsheetApp:{openById:()=>{opens++;return {getSheetByName:(name:string)=>sheets[name]};},flush:()=>{},CopyPasteType:{PASTE_FORMAT:'format'}},LockService:{getScriptLock:()=>({tryLock:()=>true,hasLock:()=>true,releaseLock:()=>{}})}});
 vm.runInContext(googleConnectionScript(token),context);
 const send=(body:unknown)=>JSON.parse((context.doPost as (e:unknown)=>string)({postData:{contents:JSON.stringify(body)}}));
 assert.equal(send({token:'bad',action:'ping',spreadsheetId:id}).ok,false);assert.equal(opens,0);
 const batch={id:crypto.randomUUID(),file:'mmsoctm06.xlsx',clientId:'mmsoctm',series:6,dateSerial:46310,count:2,allocations:[{language:'Tamil',start:3,cells:[['New','','TAMIL NADU','600001','9876543210'],['Other','','TAMIL NADU','600002','9876543211']]}]};
 const first=send({token,action:'sync',spreadsheetId:id,batch});assert.equal(first.ok,true);assert.equal(first.written,2);assert.equal(first.reportRow,2);assert.equal(first.ranges.Tamil,'3-4');
 const replay=send({token,action:'sync',spreadsheetId:id,batch});assert.equal(replay.ok,true);assert.equal(replay.reportRow,2);assert.equal(sheets['MMS LEAD REPORT'].getLastRow(),2);
 const before=JSON.stringify(sheets.TN.rows),conflict=structuredClone(batch);conflict.id=crypto.randomUUID();conflict.file='mmsoctm07.xlsx';conflict.allocations[0].cells[0]=['Changed','','TAMIL NADU','600001','9876543212'];assert.equal(send({token,action:'sync',spreadsheetId:id,batch:conflict}).ok,false);assert.equal(JSON.stringify(sheets.TN.rows),before);
 const duplicate=structuredClone(batch);duplicate.id=crypto.randomUUID();duplicate.file='mmsoctm08.xlsx';duplicate.allocations[0].start=5;duplicate.allocations[0].cells[0][4]='9876543200';assert.equal(send({token,action:'sync',spreadsheetId:id,batch:duplicate}).ok,false);assert.equal(JSON.stringify(sheets.TN.rows),before);
});
