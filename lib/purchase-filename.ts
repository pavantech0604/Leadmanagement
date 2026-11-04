export type PurchasePurpose='company-use'|'resale'|'unclassified';
export function classifyPurchaseFile(file:string):PurchasePurpose{
 const name=file.trim();
 return /^mms/i.test(name)?'resale':/^\d/.test(name)?'company-use':'unclassified';
}
export const purchasePurposeLabel:Record<PurchasePurpose,string>={
 'company-use':'Company use',resale:'Customer order',unclassified:'Unclassified'
};
export function originalImportName(file:string){
 if(!file.trim()||file.length>180||/[<>:"/\\|?*]/.test(file)||Array.from(file).some(c=>c.charCodeAt(0)<32)||!(/\.(csv|xlsx|xls)$/i.test(file)))throw Error('Choose a CSV or Excel file with a valid filename.');
 const purpose=classifyPurchaseFile(file);
 const series=purpose==='resale'?(file.match(/(\d+)\.[^.]+$/)?.[1]??''):'';
 return {file,series,clientId:purpose==='resale'?(file.match(/^(.+?)\d+\.[^.]+$/)?.[1]??'MMS'):'',needsInitialFile:false,previousFile:'',purpose};
}
