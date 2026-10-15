import {parseLeadFile} from './import-file';
self.onmessage=(event:MessageEvent<{content:ArrayBuffer;name:string}>)=>{
 try{self.postMessage({result:parseLeadFile(event.data.content,event.data.name)})}
 catch(error){self.postMessage({error:error instanceof Error?error.message:'Unable to read file'})}
};
