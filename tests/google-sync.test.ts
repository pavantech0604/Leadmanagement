import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {Batch} from '../lib/types';

test('Google connection validates its target and durable sync jobs are verified, retryable and idempotent',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cg-google-sync-'));
 process.env.WORKSPACE_FILE=path.join(root,'workspace.json');process.env.BACKUP_DIRECTORY=path.join(root,'backups');process.env.GOOGLE_SYNC_CONNECTION_FILE=path.join(root,'private','connection.json');
 const originalFetch=globalThis.fetch;
 try{
  const {seed,mutate,readStore}=await import('../lib/store');
  const api=await import('../lib/google-sync');
  const batch:Batch={id:crypto.randomUUID(),file:'mmsoctm06.xlsx',sourceFile:'random.xlsx',series:'6',clientId:'mmsoctm',at:'2026-10-15T05:00:00Z',by:'Owner',branchId:'',vendor:'',total:2,valid:2,duplicates:0,errors:0,rows:[],poolAppends:[{language:'Tamil',start:3,cells:[['New','','TAMIL NADU','600001','+919876543210'],['Other','','TAMIL NADU','600002','+919876543211']]}]};
  const s=seed();s.batches=[batch];s.leads=[];s.audit=[];await fs.writeFile(process.env.WORKSPACE_FILE!,JSON.stringify(s));
  let calls=0,badReceipt=false;
  globalThis.fetch=async(_url,options)=>{const p=JSON.parse(options?.body as string);if(p.action==='ping')return Response.json({ok:true,spreadsheetId:api.googleSpreadsheetId});calls++;return Response.json({ok:true,spreadsheetId:api.googleSpreadsheetId,batchId:p.batch.id,reportRow:22,written:badReceipt?999:p.batch.count,ranges:{Tamil:'3-4'}});};
  await t.test('private connection setup never accepts arbitrary hosts',async()=>{assert.equal(api.validConnectionUrl('http://localhost/exec'),false);assert.equal(api.validConnectionUrl('https://script.google.com.evil.example/macros/s/1234567890123456/exec'),false);assert.equal((await api.googleConnectionStatus()).connected,false);await api.prepareGoogleConnection();await api.connectGoogle('https://script.google.com/macros/s/'+('A'.repeat(24))+'/exec');assert.equal((await api.googleConnectionStatus()).connected,true);});
  await t.test('parallel queue triggers send once and only save a verified receipt',async()=>{await Promise.all([api.runGoogleSyncQueue(),api.runGoogleSyncQueue()]);const result=await readStore();assert.equal(calls,1);assert.equal(result.batches[0].googleSync?.written,2);assert.equal(result.batches[0].syncJob?.status,'synced');await api.runGoogleSyncQueue();assert.equal(calls,1);});
  await t.test('wrong remote counts leave a durable error and successful retries recover',async()=>{const second=structuredClone(batch);second.id=crypto.randomUUID();second.file='mmsoctm07.xlsx';second.series='7';await mutate(s=>{s.batches.push(second);});badReceipt=true;await api.runGoogleSyncQueue();let result=await readStore();assert.equal(result.batches[1].googleSync,undefined);assert.equal(result.batches[1].syncJob?.status,'error');badReceipt=false;await api.runGoogleSyncQueue(true);result=await readStore();assert.equal(result.batches[1].syncJob?.status,'synced');assert.equal(result.batches[1].syncJob?.attempts,2);});
  await t.test('payload retains source rows, normalizes phones and rejects wrong ranges',()=>{const payload=api.batchSyncPayload(batch);assert.equal(payload.allocations[0].cells[0][4],'9876543210');assert.equal(payload.allocations[0].start,3);assert.throws(()=>api.verifiedGoogleReceipt(batch,{batchId:batch.id,written:2,reportRow:22,ranges:{Tamil:'4-5'}}),/different range/);});
 }finally{globalThis.fetch=originalFetch;delete process.env.WORKSPACE_FILE;delete process.env.BACKUP_DIRECTORY;delete process.env.GOOGLE_SYNC_CONNECTION_FILE;await fs.rm(root,{recursive:true,force:true});}
});
