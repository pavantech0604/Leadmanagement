import {canTransfer} from './permissions';
import {parsePhoneNumberFromString} from 'libphonenumber-js';
import {ImportRow,Lead,User} from './types';
const aliases:Record<string,string>={en:'English',eng:'English',english:'English',hi:'Hindi',hindi:'Hindi','हिंदी':'Hindi',ta:'Tamil',tamil:'Tamil','தமிழ்':'Tamil',te:'Telugu',telugu:'Telugu','తెలుగు':'Telugu',ml:'Malayalam',malayalam:'Malayalam','മലയാളം':'Malayalam',kn:'Kannada',kannada:'Kannada','ಕನ್ನಡ':'Kannada'};
export function normalizePhone(value:string){const p=parsePhoneNumberFromString(value.replace(/[^+\d]/g,''),'IN');return p?.isValid()?p.number:''}
// Business routing by state; this is not a claim about a customer's spoken language.
const stateLanguages:Record<string,string>={tamilnadu:'Tamil',tn:'Tamil',intn:'Tamil','தமிழ்நாடு':'Tamil',andhrapradesh:'Telugu',ap:'Telugu',inap:'Telugu',telangana:'Telugu',ts:'Telugu',tg:'Telugu',ints:'Telugu',intg:'Telugu'};
const stateKey=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[\s._-]+/g,'');
export function detectImportColumns(cols:string[]){
 const match=(pattern:RegExp)=>cols.find(c=>pattern.test(c.trim()))||'';
 return {name:match(/^(customer[ _-]*name|full[ _-]*name|client[ _-]*name|lead[ _-]*name|cust[ _-]*name|name|customer)$/i),phone:match(/phone|mobile|contact.*(number|no)/i),email:match(/email/i),language:match(/language/i),state:match(/^(state([ _-]*name)?|province|customer[ _-]*state)$/i)};
}
function resolveLanguage(value:string,state:string,fallback:string,languages:string[]){
 if(state){const routed=stateLanguages[stateKey(state)];return routed?{language:routed,languageSource:`State: ${state}`}:{language:state,languageSource:'Needs review',languageError:`Unrecognized state: ${state}. Correct this value or unmap the State column to use language values.`}}
 const explicit=aliases[value.toLowerCase()]||languages.find(l=>l.toLowerCase()===value.toLowerCase());
 if(value&&explicit)return {language:explicit,languageSource:'Language column'};
 const routed=stateLanguages[stateKey(state||value)];
 if(routed&&(!value||stateLanguages[stateKey(value)]))return {language:routed,languageSource:`State: ${state||value}`};
 if(value||state)return {language:value||state,languageSource:'Needs review',languageError:`Unrecognized ${value?'language':'state'}: ${value||state}. Map a language column or correct this value.`};
 const selected=fallback||'Unassigned';
 return {language:aliases[selected.toLowerCase()]||languages.find(l=>l.toLowerCase()===selected.toLowerCase())||selected,languageSource:fallback?'Default language':'Unassigned'};
}
export function canSee(user:User,lead:Lead,users:User[]=[]){return user.role==='Admin'||(!lead.branchId&&canTransfer(user))||(user.branchIds.includes(lead.branchId)&&(user.role==='Employee'?lead.assignedTo===user.id:user.role==='Team Leader'?users.some(u=>u.id===lead.assignedTo&&u.team===user.team):true))}
export function inspectRows(raw:Record<string,string>[],mapping:Record<string,string>,fallback:string,languages:string[],existing:Lead[]):ImportRow[]{
 const seen=new Map<string,{id:string;name:string}>();existing.forEach(l=>seen.set(l.phone,l));
 const emails=new Map(existing.filter(l=>l.email).map(l=>[l.email.toLowerCase(),l]));
 return raw.map((r,i)=>{const get=(k:string)=>String(r[mapping[k]]??'').trim();const name=get('name').replace(/[^\p{L}\p{N}\s.'-]/gu,'').replace(/\s+/g,' ');const phone=normalizePhone(get('phone'));const email=get('email').toLowerCase();const {language,languageSource,languageError}=resolveLanguage(get('language'),get('state'),fallback,languages);
 let state:ImportRow['state']='Valid',reason='',existingId:string|undefined;
 if(!name||!phone||languageError||!languages.includes(language)||(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))){state='Error';reason=!name?'Missing customer name':!phone?'Invalid phone number':languageError||(!languages.includes(language)?'Unknown language':'Invalid email')}
 else {const match=seen.get(phone);if(match){existingId=match.id||undefined;state=match.name.toLowerCase()===name.toLowerCase()?'Duplicate':'Potential duplicate';reason=match.id?'Phone already exists':'Repeated phone within file'}else if(email&&emails.has(email)){state='Potential duplicate';existingId=emails.get(email)!.id;reason='Email matches existing lead'}else{seen.set(phone,{id:'',name});if(email)emails.set(email,{id:'',name} as Lead)}}
 return {row:i+2,raw:r,name,phone,email,language,languageSource,state,reason,existingId};
 });
}
