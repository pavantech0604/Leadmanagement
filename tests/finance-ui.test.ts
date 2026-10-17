import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToString} from 'react-dom/server';
import {LeadCommerce} from '../components/lead-commerce';
import {FinanceDashboard} from '../components/finance-dashboard';
import {financeSummary} from '../lib/lead-finance';
import {seed} from '../lib/store';
test('older workspaces without sales or purchase ledgers render the finance forms safely',()=>{
 const store=seed();store.batches=[];
 const html=renderToString(createElement(LeadCommerce,{data:{...store,user:store.users[0],financeSummary:financeSummary(store)},refresh:async()=>{},notify:()=>{}}));
 assert.match(html,/New sales request/);assert.match(html,/Buying company/);assert.match(html,/No external sales yet/);assert.match(html,/Net lead result/);
 const purchases=renderToString(createElement(LeadCommerce,{data:{...store,user:store.users[0]},initialTab:'purchases',refresh:async()=>{},notify:()=>{}}));assert.match(purchases,/Vendor purchase register/);assert.match(purchases,/Cost of older pipeline stock/);
 assert.equal(renderToString(createElement(FinanceDashboard,{go:()=>{}})),'');
});
