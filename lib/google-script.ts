// Deployed by the owner to Google Apps Script. No read/export endpoint is exposed.
export function googleConnectionScript(token:string){return `
var CG_SHEET = '10Cji9fGZenyi4BLnIodt98z8C1iAPTo3yWCPTaNjpoE';
var CG_TOKEN = ${JSON.stringify(token)};
var CG_POOLS = {Telugu:['AP',3],Tamil:['TN',4],Kannada:['KA',4],Hindi:['HI',6],Malayalam:['KL',3]};
function cgReply(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
function cgPhone(value){var p=String(value||'').replace(/\\D/g,'');return p.length===12&&p.indexOf('91')===0?p.slice(2):p;}
function cgText(value){return String(value===null||value===undefined?'':value);}
function cgEqual(a,b,phone){for(var i=0;i<a.length;i++)if(i===phone?cgPhone(a[i])!==cgPhone(b[i]):cgText(a[i])!==cgText(b[i]))return false;for(var j=a.length;j<b.length;j++)if(cgText(b[j])!=='')return false;return true;}
function cgLiteral(value){var text=cgText(value);return /^[=+@-]/.test(text)?"'"+text:text;}
function doPost(e){
 var lock;
 try{
  var p=JSON.parse(e.postData.contents||'{}');
  if(typeof p.token!=='string'||p.token.length!==CG_TOKEN.length)throw Error('Connection authentication failed.');
  var diff=0;for(var t=0;t<CG_TOKEN.length;t++)diff|=p.token.charCodeAt(t)^CG_TOKEN.charCodeAt(t);if(diff)throw Error('Connection authentication failed.');
  if(p.spreadsheetId!==CG_SHEET)throw Error('Unexpected spreadsheet.');
  var book=SpreadsheetApp.openById(CG_SHEET);
  if(p.action==='ping')return cgReply({ok:true,spreadsheetId:CG_SHEET});
  if(p.action!=='sync'||!p.batch||!Array.isArray(p.batch.allocations))throw Error('Invalid sync request.');
  lock=LockService.getScriptLock();if(!lock.tryLock(25000))throw Error('Another delivery is syncing. Retry shortly.');
  var b=p.batch,report=book.getSheetByName('MMS LEAD REPORT');
  if(!report||!/^[-a-zA-Z0-9_ .]+\\.xlsx$/.test(b.file)||b.file.length>180||typeof b.clientId!=='string'||b.clientId.length>100||!/^[a-f0-9-]{36}$/i.test(b.id)||!Number.isSafeInteger(b.series)||b.series<1||!Number.isSafeInteger(b.dateSerial)||b.dateSerial<1)throw Error('Invalid upload identity.');
  var headers=report.getRange(1,1,1,11).getDisplayValues()[0].map(function(x){return x.trim().toUpperCase();});
  if(headers[0]!=='DATE'||headers[3]!=='SERIES NO'||headers[9]!=='TOTAL LEAD'||headers[10]!=='FILE NAME')throw Error('MMS report columns changed. Review the connection.');
  var phones={},pendingPhones={},total=0,plans=[],ranges={},langs={};
  Object.keys(CG_POOLS).forEach(function(language){var spec=CG_POOLS[language],sheet=book.getSheetByName(spec[0]);if(!sheet)throw Error('Language sheet missing.');var last=sheet.getLastRow();if(last)sheet.getRange(1,spec[1]+1,last,1).getValues().forEach(function(row,i){var phone=cgPhone(row[0]);if(phone.length>=10)(phones[phone]||(phones[phone]=[])).push(spec[0]+':'+(i+1));});});
  b.allocations.forEach(function(a){
   var spec=CG_POOLS[a.language],cells=a.cells;
   if(!spec||langs[a.language]||!Number.isSafeInteger(a.start)||a.start<1||!Array.isArray(cells)||!cells.length)throw Error('Invalid language ranges.');langs[a.language]=true;
   var sheet=book.getSheetByName(spec[0]),width=cells[0].length,end=a.start+cells.length-1;
   if(width<=spec[1]||width>26||end>1000000)throw Error('Invalid source columns or row limit.');
   var readCount=Math.max(0,Math.min(cells.length,sheet.getMaxRows()-a.start+1));
   var old=readCount?sheet.getRange(a.start,1,readCount,Math.max(width,sheet.getLastColumn())).getValues():[];
   cells.forEach(function(row,i){
    if(!Array.isArray(row)||row.length!==width||row.some(function(v){return typeof v!=='string'||v.length>5000;}))throw Error('Invalid lead cells.');
    var phone=cgPhone(row[spec[1]]),location=spec[0]+':'+(a.start+i);
    if(phone.length<10||!row[0].trim()||pendingPhones[phone])throw Error('Duplicate or invalid phone in upload.');pendingPhones[phone]=true;
    if((phones[phone]||[]).some(function(x){return x!==location;}))throw Error('A phone now exists elsewhere in Google Sheets. Review this pending upload.');
    var previous=old[i]||[];
    if(previous.some(function(v){return cgText(v)!=='';})&&!cgEqual(row,previous,spec[1]))throw Error('Destination rows contain different data. Nothing will be overwritten.');
   });
   total+=cells.length;plans.push({sheet:sheet,a:a,end:end});ranges[a.language]=a.start+'-'+end;
  });
  if(total!==b.count||total<1||total>10000)throw Error('Upload total does not match its ranges.');
  var reportRow=0,lastReport=report.getLastRow(),notes=report.getRange(1,1,Math.max(1,lastReport),1).getNotes();
  var files=report.getRange(1,11,Math.max(1,lastReport),1).getValues();
  notes.forEach(function(row,i){if(row[0]==='Capital Grow import: '+b.id)reportRow=i+1;});
  files.forEach(function(row,i){if(cgText(row[0]).toLowerCase()===b.file.toLowerCase()&&i+1!==reportRow)throw Error('This report filename already exists.');});
  reportRow=reportRow||lastReport+1;
  var values=[b.dateSerial,'',b.clientId,b.series,ranges.Telugu||'',ranges.Kannada||'',ranges.Tamil||'',ranges.Malayalam||'',ranges.Hindi||'',total,b.file];
  if(reportRow<=lastReport){var existing=report.getRange(reportRow,1,1,11).getValues()[0];if(existing[10]!==b.file||Number(existing[3])!==b.series||Number(existing[9])!==total)throw Error('Existing sync receipt differs. Review the report.');}
  plans.forEach(function(plan){
   if(plan.end>plan.sheet.getMaxRows())plan.sheet.insertRowsAfter(plan.sheet.getMaxRows(),plan.end-plan.sheet.getMaxRows());
   var a=plan.a,target=plan.sheet.getRange(a.start,1,a.cells.length,a.cells[0].length);
   if(a.start>1)plan.sheet.getRange(a.start-1,1,1,a.cells[0].length).copyTo(target,SpreadsheetApp.CopyPasteType.PASTE_FORMAT,false);
   target.setValues(a.cells.map(function(row){return row.map(cgLiteral);}));
  });
  SpreadsheetApp.flush();
  plans.forEach(function(plan){var a=plan.a,actual=plan.sheet.getRange(a.start,1,a.cells.length,a.cells[0].length).getDisplayValues();actual.forEach(function(row,i){var expected=a.cells[i];for(var k=0;k<expected.length;k++){if(cgText(row[k])!==cgText(expected[k]))throw Error('Google readback did not match. Retry will preserve already-written rows.');}});});
  if(reportRow>report.getMaxRows())report.insertRowsAfter(report.getMaxRows(),reportRow-report.getMaxRows());
  if(reportRow>2)report.getRange(reportRow-1,1,1,11).copyTo(report.getRange(reportRow,1,1,11),SpreadsheetApp.CopyPasteType.PASTE_FORMAT,false);
  report.getRange(reportRow,1,1,11).setValues([values.map(function(v){return typeof v==='string'?cgLiteral(v):v;})]);report.getRange(reportRow,1).setNumberFormat('dd-mm-yyyy').setNote('Capital Grow import: '+b.id);report.setRowHeight(reportRow,32);
  SpreadsheetApp.flush();
  var receipt=report.getRange(reportRow,1,1,11).getValues()[0];if(receipt[10]!==b.file||Number(receipt[3])!==b.series||Number(receipt[9])!==total||receipt[2]!==b.clientId||[4,5,6,7,8].some(function(i){return cgText(receipt[i])!==cgText(values[i]);}))throw Error('Report readback failed. Retry this upload.');
  return cgReply({ok:true,spreadsheetId:CG_SHEET,batchId:b.id,reportRow:reportRow,written:total,ranges:ranges});
 }catch(error){return cgReply({ok:false,error:cgText(error.message||'Sync failed.').slice(0,220)});}
 finally{if(lock&&lock.hasLock())lock.releaseLock();}
}
`;}
