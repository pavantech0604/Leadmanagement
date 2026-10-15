import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildEnvironment} from '../scripts/vercel.mjs';
test('legacy cache alias becomes a valid npm setting without dropping credentials or mutating the parent environment',()=>{
 const original={npm_config_cache_dir:'/cache/npm',PRIVATE_DATABASE:'private-value'};
 const result=buildEnvironment(original);
 assert.equal(result.npm_config_cache,'/cache/npm');assert.equal(result.npm_config_cache_dir,undefined);
 assert.equal(result.PRIVATE_DATABASE,original.PRIVATE_DATABASE);assert.equal(original.npm_config_cache_dir,'/cache/npm');
});
test('explicit npm cache wins and unrelated settings are retained',()=>{
 const result=buildEnvironment({NPM_CONFIG_CACHE:'/correct',NPM_CONFIG_CACHE_DIR:'/legacy',CI:'1'});
 assert.equal(result.NPM_CONFIG_CACHE,'/correct');assert.equal(result.npm_config_cache,undefined);assert.equal(result.NPM_CONFIG_CACHE_DIR,undefined);assert.equal(result.CI,'1');
});
