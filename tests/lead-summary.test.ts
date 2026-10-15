import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeLeads} from '../lib/lead-summary';
import type {Lead} from '../lib/types';

test('single-pass summary preserves India date boundaries, conversions and follow-ups',()=>{
 const base={id:'a',name:'A',phone:'',email:'',language:'Tamil',branchId:'b',vendor:'v',assignedTo:'',originalPhone:'',notes:[],history:[],custom:{}};
 const leads:Lead[]=[
  {...base,createdAt:'2026-10-12T19:00:00Z',status:'Converted',followUp:'2026-10-12T19:00:00Z'},
  {...base,createdAt:'2026-10-12T18:00:00Z',status:'New',followUp:'2026-10-12T19:00:00Z'},
  {...base,createdAt:'2026-09-01T00:00:00Z',status:'New',followUp:'2026-10-11T00:00:00Z'},
 ];
 const s=summarizeLeads(leads,new Date('2026-10-13T09:00:00Z'));
 assert.equal(s.receivedToday,1);assert.equal(s.converted,1);assert.equal(s.due.length,1);assert.equal(s.overdue.length,1);
 assert.equal(s.trend.length,14);assert.equal(s.trend.at(-1)?.converted,1);assert.equal(s.trend.at(-2)?.leads,1);
});
test('3000-lead summary processes the full dataset',()=>{
 const lead={id:'a',name:'A',phone:'',email:'',language:'Tamil',branchId:'b',vendor:'v',assignedTo:'',originalPhone:'',notes:[],history:[],custom:{},status:'New',followUp:'',createdAt:'2026-10-13T00:00:00Z'} as Lead;
 const start=performance.now();const result=summarizeLeads(Array(3000).fill(lead),new Date('2026-10-13T09:00:00Z'));
 assert.equal(result.receivedToday,3000);assert.equal(result.trend.at(-1)?.leads,3000);
 console.log(`3000-lead summary: ${(performance.now()-start).toFixed(1)}ms`);
});
