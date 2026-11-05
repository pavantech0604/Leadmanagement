export async function encodeImportRequest(value:unknown):Promise<{body:BodyInit;headers:Record<string,string>}>{
 const json=JSON.stringify(value);
 if(json.length<32768||typeof CompressionStream==='undefined')return {body:json as BodyInit,headers:{'Content-Type':'application/json'}};
 const stream=new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
 const compressed=await new Response(stream).arrayBuffer();
 return {body:compressed as BodyInit,headers:{'Content-Type':'application/json','Content-Encoding':'gzip'}};
}
