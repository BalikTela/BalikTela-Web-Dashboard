import { Pencil, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyBlock } from '../components/StateBlock';
import { SectionHeader } from '../components/SectionHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { RecordEditor } from '../components/RecordEditor';
import type { BarterListing } from '../platformTypes';
import { platformApi } from '../services/platformApi';
import { Panel } from '../components/Panel';
import { useAuth } from '../context/AuthContext';
import { useRecordRefresh } from '../hooks/useRecordRefresh';

export function ListingOversight() {
  const {access}=useAuth();
  const canManage=access?.permissions.includes('listings.manage');
  const [listings,setListings]=useState<BarterListing[]>([]);
  const [query,setQuery]=useState('');
  const [status,setStatus]=useState('All statuses');
  const [editing,setEditing]=useState<BarterListing|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const load=useCallback(async()=>{try{setListings((await platformApi.listings()).listings);setError('');}catch(reason){setError(reason instanceof Error?reason.message:'Unable to load listings.');}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();},[load]);
  useRecordRefresh(load,['/barter','/material-batches','/transfers']);
  const rows=useMemo(()=>listings.filter(item=>status==='All statuses'||item.status===status).filter(item=>[item.id,item.batchId,item.title,item.ownerName,item.textileType,item.city,item.region].join(' ').toLowerCase().includes(query.toLowerCase())),[listings,query,status]);
  return <div className="space-y-5">
    <section className="grid overflow-hidden rounded-md border border-[#dfe5e2] bg-white sm:grid-cols-2 xl:grid-cols-4">{[['Recorded listings',listings.length],['Open',listings.filter(item=>item.status==='Open').length],['Matched or reserved',listings.filter(item=>['Matched','Reserved'].includes(item.status)).length],['Completed',listings.filter(item=>item.status==='Completed').length]].map(([label,value])=><div key={label} className="border-b border-[#e7ece9] p-5 sm:border-r xl:border-b-0"><p className="text-xs text-[#66736e]">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</p></div>)}</section>
    <Panel><SectionHeader title="Material Listing Oversight" eyebrow="Mobile-originated material availability and administrative review" actions={<div className="flex flex-wrap gap-2"><label className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><Input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search listings" className="w-full pl-9 sm:w-64"/></label><Select aria-label="Listing status" value={status} onChange={e=>setStatus(e.target.value)}>{['All statuses','Open','Matched','Reserved','Completed','Closed'].map(item=><option key={item}>{item}</option>)}</Select></div>}/>
      {error?<p role="alert" className="text-sm text-red-700">{error}</p>:loading?<div className="grid min-h-64 place-items-center text-sm text-[#718079]">Loading authorized listing records...</div>:rows.length?<div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><thead><tr><th>Listing</th><th>Material batch</th><th>Owner</th><th>Material</th><th>Source / form</th><th>Quantity</th><th>Pathway</th><th>Location</th><th>Status</th><th>Actions</th></tr></thead><tbody className="divide-y divide-[#dfe5e2]">{rows.map(item=><tr key={item.id}><td className="py-3"><p className="font-medium">{item.title}</p><p className="mt-0.5 text-xs text-[#718079]">{item.id} · {item.isDemo?'Demo':'Operational'}</p></td><td>{item.batchId}</td><td>{item.ownerName}</td><td>{item.textileType}<p className="text-xs text-[#718079]">{item.quality}</p></td><td>{item.wasteSource}<p className="text-xs text-[#718079]">{item.wasteForm}</p></td><td>{item.quantityKg.toLocaleString()} kg<p className="text-xs text-[#718079]">{item.weightStatus}</p></td><td>{item.circularPathway}</td><td>{item.city}<p className="text-xs text-[#718079]">{item.region}</p></td><td><Badge variant="outline">{item.status}</Badge></td><td>{canManage && ['Open','Matched','Closed'].includes(item.status)?<Button variant="ghost" size="icon" title={`Manage ${item.id}`} aria-label={`Manage ${item.id}`} onClick={()=>setEditing(item)}><Pencil size={15}/></Button>:null}</td></tr>)}</tbody></table></div>:<EmptyBlock label="No material listings match these filters."/>}
    </Panel>
    {editing?<RecordEditor title="Review material listing" initial={{...editing,reason:''}} fields={[{key:'title',label:'Listing title',required:true},{key:'status',label:'Availability',type:'select',options:editing.status==='Matched'?['Matched','Open','Closed']:['Open','Closed']},{key:'description',label:'Description',type:'textarea'},{key:'reason',label:'Review reason',type:'textarea',required:true}]} onClose={()=>setEditing(null)} onSave={values=>platformApi.updateListing(editing.id,values)}/>:null}
  </div>;
}
