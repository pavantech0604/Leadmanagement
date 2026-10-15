import type {Lead} from './types';

const calendar=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'});
const label=new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short'});
export const leadDay=(value:string|Date)=>calendar.format(new Date(value));
export function summarizeLeads(leads:Lead[],now=new Date()){
 const today=leadDay(now),due:Lead[]=[],overdue:Lead[]=[];
 const trend=Array.from({length:14},(_,i)=>{const d=new Date(now.getTime()-(13-i)*86400000);return {key:leadDay(d),date:label.format(d),leads:0,converted:0}});
 const buckets=new Map(trend.map(row=>[row.key,row]));
 let converted=0,receivedToday=0;
 for(const lead of leads){
  const created=leadDay(lead.createdAt),bucket=buckets.get(created);
  if(created===today)receivedToday++;
  if(lead.status==='Converted')converted++;
  if(bucket){bucket.leads++;if(lead.status==='Converted')bucket.converted++}
  if(lead.followUp&&!['Converted','Dead','Archived'].includes(lead.status)){
   const followUp=leadDay(lead.followUp);if(followUp===today)due.push(lead);else if(followUp<today)overdue.push(lead);
  }
 }
 return {converted,receivedToday,due,overdue,trend};
}
