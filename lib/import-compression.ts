import {promisify} from 'node:util';
import {gzip,gunzip} from 'node:zlib';
import type {Batch,Store} from './types';
const zip=promisify(gzip),unzip=promisify(gunzip);
export async function archiveBatchRows(batch:Batch){
 const rows=batch.rows;
 const encoded=Buffer.from(JSON.stringify(rows.map(row=>row.raw)));
 const compressed=await zip(encoded);
 if(compressed.length*1.4>=encoded.length)return batch;
 return {...batch,rawArchive:compressed.toString('base64'),rows:rows.map(row=>({...row,raw:{}}))};
}
export async function restoreBatchRows(s:Store){
 await Promise.all(s.batches.map(async batch=>{
  if(!batch.rawArchive)return;
  const decoded=await unzip(Buffer.from(batch.rawArchive,'base64'),{maxOutputLength:32*1024*1024});
  const raw=JSON.parse(decoded.toString('utf8')) as Batch['rows'][number]['raw'][];
  if(!Array.isArray(raw)||raw.length!==batch.rows.length)throw Error('Import archive could not be verified.');
  batch.rows=batch.rows.map((row,i)=>({...row,raw:raw[i]}));
 }));
 return s;
}
export async function decodeWorkspaceBody(request:Request){
 if(request.headers.get('content-encoding')!=='gzip')return request.json();
 const bytes=Buffer.from(await request.arrayBuffer());
 if(bytes.length>12*1024*1024)throw Error('Upload request is too large.');
 const decoded=await unzip(bytes,{maxOutputLength:32*1024*1024});
 return JSON.parse(decoded.toString('utf8'));
}
