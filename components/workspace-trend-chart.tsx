'use client';
import {ResponsiveContainer,AreaChart,Area,XAxis,YAxis,Tooltip,CartesianGrid} from 'recharts';

export function WorkspaceTrendChart({trend}:{trend:object[]}){
 return <ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{top:10,right:10,left:-25,bottom:0}}><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-received)" stopOpacity={.22}/><stop offset="100%" stopColor="var(--chart-received)" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--line)"/><XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={35} tick={{fill:'#9293a4',fontSize:11}}/><YAxis axisLine={false} tickLine={false} tick={{fill:'#9293a4',fontSize:11}}/><Tooltip contentStyle={{background:'var(--panel)',border:'1px solid var(--line)',borderRadius:12}}/><Area type="monotone" dataKey="leads" name="Received" stroke="var(--chart-received)" strokeWidth={3} fill="url(#fill)"/><Area type="monotone" dataKey="converted" name="Converted" stroke="var(--chart-converted)" strokeWidth={2} fill="transparent"/></AreaChart></ResponsiveContainer>;
}
