import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export function buildEnvironment(source){
 const env={...source};
 // Some hosting tools export the legacy cache-dir alias. npm accepts cache.
 for(const key of Object.keys(env)){
  if(/^npm_config_cache[-_]dir$/i.test(key)){
   if(!Object.keys(env).some(name=>name.toLowerCase()==='npm_config_cache'))env.npm_config_cache=env[key];
   delete env[key];
  }
 }
 return env;
}
export function runBuildCommand(action){
 const commands={install:['ci','--include=dev'],build:['run','build']};
 const args=commands[action];if(!args)throw Error('Use install or build.');
 const windows=process.platform==='win32';
 const result=spawnSync(windows?'cmd.exe':'npm',windows?['/d','/s','/c',`npm ${args.join(' ')}`]:args,{env:buildEnvironment(process.env),stdio:'inherit'});
 if(result.error){console.error('Could not start npm:',result.error.message);return 1}
 return result.status??1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=runBuildCommand(process.argv[2]);
