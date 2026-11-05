import {test} from 'node:test';
import assert from 'node:assert/strict';
import {archiveBatchRows,restoreBatchRows,decodeWorkspaceBody} from '../lib/import-compression';
import {encodeImportRequest} from '../lib/import-request';
import {seed} from '../lib/store';
import type {Batch} from '../lib/types';
test('gzip requests and stored raw rows round trip without changing lead data',async()=>{
 const rows=Array.from({length:1999},(_,i)=>({Name:'Lead '+i,State:'TAMIL NADU',Phone:String(9876500000+i)}));
 const value={action:'import',rows};
 const request=await encodeImportRequest(value);
 const recovered=await decodeWorkspaceBody(new Request('http://localhost/api/workspace',{method:'POST',...request}));
 assert.deepEqual(recovered,value);
 const batch={id:'test',rows:rows.map((raw,i)=>({row:i+2,raw,state:'Valid'}))} as unknown as Batch;
 const archived=await archiveBatchRows(batch);assert.ok(archived.rawArchive);assert.deepEqual(batch.rows[0].raw,rows[0]);assert.deepEqual(archived.rows[0].raw,{});
 const restored=await restoreBatchRows({...seed(),batches:[archived]});assert.deepEqual(restored.batches[0].rows,batch.rows);
 console.log(JSON.stringify({requestRaw:Buffer.byteLength(JSON.stringify(value)),requestCompressed:(request.body as ArrayBuffer).byteLength,archiveRaw:Buffer.byteLength(JSON.stringify(rows)),archiveBase64:archived.rawArchive.length}));
});
test('malformed gzip is rejected instead of imported',async()=>{
 await assert.rejects(decodeWorkspaceBody(new Request('http://localhost/api/workspace',{method:'POST',headers:{'Content-Encoding':'gzip'},body:'invalid'})));
});
