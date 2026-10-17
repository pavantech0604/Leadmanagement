'use client';
import type {FinanceSummary} from '@/lib/lead-finance';
import {money} from '@/lib/money';
import {ArrowUpRight,ShoppingBag,IndianRupee,TrendingUp} from 'lucide-react';
export function FinanceDashboard({summary,go}:{summary?:FinanceSummary;go:(section:'sales'|'purchases')=>void}){
 if(!summary)return null;
 return <section className="finance-overview" aria-label="Lead business finances"><div className="finance-overview-heading"><div><span className="ops-eyebrow">YOUR LEAD BUSINESS · ALL TIME</span><h2>Buying, selling & returns</h2></div><button className="button secondary" onClick={()=>go('sales')}>Sales & costs<ArrowUpRight size={15}/></button></div><div className="finance-metrics">
 <button onClick={()=>go('purchases')}><ShoppingBag size={18}/><span>Recorded vendor spend</span><strong>{money(summary.purchaseSpendPaise)}</strong><small>{summary.unpricedBatches?`${summary.unpricedBatches} uploads need their purchase cost`:'All uploaded files have a recorded cost'}</small></button>
 <button onClick={()=>go('sales')}><IndianRupee size={18}/><span>External sales value</span><strong>{money(summary.revenuePaise)}</strong><small>{summary.salesCount} sales · {summary.quantity.toLocaleString('en-IN')} leads delivered</small></button>
 <button onClick={()=>go('sales')} className="finance-profit"><TrendingUp size={18}/><span>Net lead result</span><strong>{summary.netResultPaise===null?'Costs pending':money(summary.netResultPaise)}</strong><small>External sales minus all recorded purchases</small></button>
 <button onClick={()=>go('sales')}><TrendingUp size={18}/><span>Margin on sold leads</span><strong>{summary.profitPaise===null?'Costs pending':money(summary.profitPaise)}</strong><small>{summary.unknownSold?`${summary.unknownSold} sold leads need purchase cost`:'Acquisition cost counted once per unique lead'}</small></button>
 </div><p className="finance-context">Internal floor deliveries remain separate from sales. Figures exclude operating expenses and taxes; sales value is recorded revenue, not a payment collection tracker.</p></section>;
}
