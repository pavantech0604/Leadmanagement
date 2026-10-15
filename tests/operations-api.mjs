import assert from 'node:assert/strict';
const base='http://localhost:3000';
async function login(userId){const r=await fetch(base+'/api/workspace',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({action:'login',userId})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]}
async function get(cookie){return(await fetch(base+'/api/workspace',{headers:{Cookie:cookie}})).json()}
async function post(cookie,body,status=200){const r=await fetch(base+'/api/workspace',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,Origin:base},body:JSON.stringify(body)});const j=await r.json();assert.equal(r.status,status,JSON.stringify(j));return j}
const owner=await login('u0');const s=await get(owner);assert.equal(s.operations.length,55);assert.equal(s.operations.find(r=>r.file==='mmsoctm04').date,'2026-10-08');
const raw={DATE:'2026-10-12',NAME:'CG Floor',LANG:'Telugu+Tamil+Kannada',RANGE:'6001-6500+5002-5501+2000-2300','FILE NAME':'preview-only.xlsx'};
const preview=await post(owner,{action:'operations-preview',kind:'dispatch',raw});assert.equal(preview.record.segments.length,3);assert.equal(preview.record.segments[0].matchedCount,500);assert.equal(preview.record.actualCount,1301);
const header=await post(owner,{action:'operations-preview',kind:'dispatch',raw:{...raw,LANG:'Telugu',RANGE:'1-2'}});assert.equal(header.record.actualCount,1);assert.equal(header.record.segments[0].headerCount,1);
await post(owner,{action:'operations-preview',kind:'dispatch',raw:{...raw,LANG:'Telugu',RANGE:'-27202'}},400);
const second=await login('u1');assert.equal((await get(second)).operations.length,55);await post(second,{action:'operations-sync'},403);
const employee=await login('u6');assert.equal((await get(employee)).operations.length,0);await post(employee,{action:'operations-preview',kind:'dispatch',raw},403);
assert.equal((await get(owner)).operations.length,s.operations.length);
console.log('PASS: register reads, dates, three-language row counts, header exclusion, invalid range blocking, two-operator access, restricted sync and no preview writes.');
