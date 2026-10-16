import {test} from 'node:test';
import assert from 'node:assert/strict';
import {useCloudStorage,workspaceFailure,databaseConnectionUrl} from '../lib/deployment';
test('Vercel refuses local storage and reports safe actionable setup errors',()=>{
 const previous={...process.env};try{
  delete process.env.STORAGE_BACKEND;delete process.env.SUPABASE_DATABASE_URL;delete process.env.SESSION_SECRET;process.env.VERCEL='1';
  assert.throws(useCloudStorage,/persistent storage/);
  process.env.STORAGE_BACKEND='supabase';assert.throws(useCloudStorage,/SUPABASE_DATABASE_URL/);
  process.env.SUPABASE_DATABASE_URL='postgresql://private:password@host/database';assert.throws(useCloudStorage,/SESSION_SECRET/);
  process.env.SESSION_SECRET='a'.repeat(32);assert.equal(useCloudStorage(),true);
  const failure=workspaceFailure(new Error('password=private-secret'));
  assert.equal(failure.status,503);assert.ok(!failure.message.includes('private-secret'));
  delete process.env.VERCEL;process.env.STORAGE_BACKEND='local';assert.equal(useCloudStorage(),false);
 }finally{for(const key of ['VERCEL','STORAGE_BACKEND','SUPABASE_DATABASE_URL','SESSION_SECRET']){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key]}}
});

test('connection validation rejects API URLs and unfilled passwords without exposing them',()=>{
 assert.throws(()=>databaseConnectionUrl('https://project.supabase.co'),/must begin with postgresql/);
 assert.throws(()=>databaseConnectionUrl('postgresql://user:[YOUR-PASSWORD]@region.pooler.supabase.com:5432/postgres'),/placeholder/);
 assert.equal(databaseConnectionUrl('  postgresql://user:private@region.pooler.supabase.com:5432/postgres  ').protocol,'postgresql:');
 for(const code of ['ENETUNREACH','ENOTFOUND','ETIMEDOUT'])assert.match(workspaceFailure({code}).message,/Session pooler/);
 assert.match(workspaceFailure({code:'SELF_SIGNED_CERT_IN_CHAIN'}).message,/certificate/);
 assert.ok(!workspaceFailure({code:'28P01',message:'password private'}).message.includes('password private'));
});
